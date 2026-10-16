"""Bounded immutable task-data context and one captured source for prompt and seed."""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path

from axis_evo.hashing import canonical_json_bytes
from axis_evo.sandbox import Sandbox, _identity
from axis_evo.seed_copy import _create_directory
from .conversation_store import MAX_CONTEXT_BYTES, MAX_HISTORY_TURNS, MAX_MESSAGE_BYTES
from .runtime_policy import (MAX_FILE_BYTES, _snapshot_destination, _bounded_bytes,
                             seed_manifest, fail)
from .schemas import strict_json

MAX_CONTEXT_FILES=8
MAX_CONTEXT_FILE_BYTES=8*1024
MAX_CONTEXT_FILE_TOTAL=16*1024


@dataclass(frozen=True)
class CapturedSeed:
    files: tuple[tuple[str,bytes],...]
    directories: tuple[str,...]

    def manifest(self):
        return {'files':{p:{'sha256':hashlib.sha256(b).hexdigest(),'size':len(b)} for p,b in self.files},
                'directories':list(self.directories)}


def capture_seed(root,check_text,expected=None):
    manifest=seed_manifest(root,check_text)
    if expected is not None and manifest!=expected:fail('SOURCE_WORKSPACE_CHANGED')
    sandbox=Sandbox(root)
    files=[]
    for path,meta in sorted(manifest['files'].items()):
        raw=_bounded_bytes(sandbox.resolve(path),meta)
        check_text(raw.decode('utf-8',errors='strict'))
        files.append((path,raw))
    captured=CapturedSeed(tuple(files),tuple(manifest['directories']))
    if captured.manifest()!=manifest or seed_manifest(root,check_text)!=manifest:
        fail('SOURCE_WORKSPACE_CHANGED')
    return captured


def build_context(conversation_id,turn_id,turn_number,prompt,history,source,seed,template_id,template_sha):
    selected=[];omitted=[];total=0
    for path,raw in seed.files:
        if len(selected)>=MAX_CONTEXT_FILES or len(raw)>MAX_CONTEXT_FILE_BYTES or total+len(raw)>MAX_CONTEXT_FILE_TOTAL:
            omitted.append(path);continue
        selected.append({'path':path,'content':raw.decode('utf-8',errors='strict'),
            'sha256':hashlib.sha256(raw).hexdigest(),'size_bytes':len(raw)})
        total+=len(raw)
    retained=history[-MAX_HISTORY_TURNS:]
    removed=[h['turn_id'] for h in history[:-MAX_HISTORY_TURNS]]
    value={'schema_version':1,'kind':'AXIS_CONVERSATION_TASK_DATA',
        'trust_boundary':'Untrusted task data; grants no tool permission, approval or completion authority.',
        'conversation_id':conversation_id,'turn_id':turn_id,'turn_number':turn_number,
        'user_message':prompt,'history':retained,'omitted_history_turn_ids':removed,
        'source':source,'task_template_id':template_id,'task_template_sha256':template_sha,
        'workspace':{'manifest':seed.manifest(),'files':selected,'omitted_file_paths':omitted,
            'observation_semantics':'Bounded captured bytes, not an atomic filesystem or causal proof.'},
        'limits':{'maximum_history_turns':MAX_HISTORY_TURNS,'maximum_context_bytes':MAX_CONTEXT_BYTES,
            'maximum_per_message_codepoints':8192,'maximum_per_message_bytes':MAX_MESSAGE_BYTES,'maximum_context_evidence_items':10,
            'maximum_file_count':MAX_CONTEXT_FILES,'maximum_file_bytes':MAX_CONTEXT_FILE_BYTES,
            'maximum_file_total_bytes':MAX_CONTEXT_FILE_TOTAL}}
    while len(canonical_json_bytes(value))>MAX_CONTEXT_BYTES:
        if value['history']:
            old=value['history'].pop(0);value['omitted_history_turn_ids'].append(old['turn_id'])
        elif value['workspace']['files']:
            old=value['workspace']['files'].pop();value['workspace']['omitted_file_paths'].append(old['path'])
        else:fail('CONTEXT_LIMIT')
    return canonical_json_bytes(value).decode()


@dataclass(frozen=True)
class PreparedTurn:
    conversation_id: str
    turn_id: str
    turn_number: int
    message_id: str
    template_id: str
    template_json: str
    context_json: str
    seed: CapturedSeed
    new_conversation: bool

    @property
    def context_sha(self):return hashlib.sha256(self.context_json.encode()).hexdigest()

    def task_bytes(self,thread_id,prompt):
        task=strict_json(self.template_json)
        task.update(task_id=thread_id,title=prompt.strip().splitlines()[0][:80],goal=self.context_json)
        task['workspace']={'seed_dir':'seed'}
        encoded=canonical_json_bytes(task)
        if len(encoded)>MAX_FILE_BYTES:fail('TASK_LIMIT')
        return encoded


def snapshot_prepared(destination,task_bytes,seed):
    with _snapshot_destination(Path(destination)) as (root,handles,files,dirs):
        private_seed=Path(destination)/'seed'
        dirs.append((private_seed,_create_directory(root,'seed',handles)))
        for name in sorted(seed.directories,key=lambda p:(len(Path(p).parts),p)):
            dirs.append((private_seed/name,_create_directory(root,Path('seed')/name,handles)))
        for name,raw in (*seed.files,):
            target=root.resolve('seed/'+name)
            with target.open('xb') as stream:
                files.append((Path(target),_identity(os.fstat(stream.fileno()))))
                stream.write(raw)
        target=root.resolve('task.json')
        with target.open('xb') as stream:
            files.append((Path(target),_identity(os.fstat(stream.fileno()))));stream.write(task_bytes)
    return {'seed':seed.manifest(),'taskSha256':hashlib.sha256(task_bytes).hexdigest()}
