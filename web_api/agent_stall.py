"""Bounded deterministic observations of a turn. No model judgments are inputs."""
from collections import deque
import hashlib
import os
from tempfile import NamedTemporaryFile

from .agent_project import snapshot
from .agent_store import digest
from .agent_workspace import fail
from .schemas import no_redirected_parents


DEFAULT_READ_STEPS = 6
EDIT_WINDOW = 12
UNCHANGED_FAILURE_LIMIT = 4
READ_TOOLS = frozenset(('read_file', 'read_document', 'list_files', 'list_directory', 'search',
    'project_overview', 'git_status', 'git_diff', 'git_log', 'inspect_changes'))
SUGGESTED_ACTIONS = ('ADD_CONSTRAINTS', 'REDUCE_CONTRACT', 'KEEP_SNAPSHOT')


def _trigger(kind, evidence, hashes=(), **fields):
    return {'stallKind':kind, 'evidenceSteps':list(evidence), 'recentHashes':list(hashes),
            'suggestedActions':list(SUGGESTED_ACTIONS), **fields}


class StallDetector:
    def __init__(self, read_steps=DEFAULT_READ_STEPS):
        self.reads = deque(maxlen=read_steps)
        self.edits = {}
        self.failures = {}
        self.last_edit = None
        self.last_observation = None

    def tool(self, number, call_id, name, args, result, *, artifact=None):
        step = {'step':number, 'callId':call_id, 'tool':name}
        self.last_observation = step
        if name in READ_TOOLS and result['status'] == 'SUCCESS':
            # Preserve distinct pages and ranges even when they identify the same file.
            observed = {key:value for key,value in args.items() if key != 'expectedSha256'}
            target = digest({'tool':name, 'args':observed})
            self.reads.append({**step, 'targetSha256':target})
            if len(self.reads) == self.reads.maxlen:
                window = list(self.reads)
                middle = len(window) // 2
                first = {item['targetSha256'] for item in window[:middle]}
                second = {item['targetSha256'] for item in window[middle:]}
                repeated = len(first & second) / len(first | second)
                if repeated >= .75:
                    return _trigger('READ_ONLY_SPIN', window, repetition=repeated)
        else:
            self.reads.clear()
        if artifact and not result.get('reusedResult'):
            key = os.path.normcase(artifact['path'])
            before, after = artifact['previousSha256'], artifact['sha256']
            if before == after:
                return None
            trail = self.edits.setdefault(key, deque(maxlen=3))
            if trail and (number - trail[-1]['step'] > EDIT_WINDOW or trail[-1]['sha256'] != before):
                trail.clear()
                self.failures.pop(key, None)
            if not trail:
                trail.append({**step, 'sha256':before})
            trail.append({**step, 'sha256':after})
            self.last_edit = (key, artifact['path'], step, after)
            if len(trail) == 3 and trail[0]['sha256'] is not None and trail[0]['sha256'] == after:
                return _trigger('EDIT_OSCILLATION', trail, (item['sha256'] for item in trail), path=artifact['path'])
        return None


    def check(self, receipt_id, failed):
        if self.last_edit is None:
            return None
        key, path, step, file_sha = self.last_edit
        if not failed:
            self.failures.pop(key, None)
            return None
        chain = self.failures.setdefault(key, deque(maxlen=UNCHANGED_FAILURE_LIMIT))
        if chain and (step['step'] - chain[-1]['step'] > EDIT_WINDOW or chain[-1]['failed'] != failed):
            chain.clear()
        if chain and (chain[-1]['step'] == step['step'] or chain[-1]['sha256'] == file_sha):
            return None
        chain.append({**step, 'sha256':file_sha, 'receiptId':receipt_id, 'failed':failed})
        if len(chain) == UNCHANGED_FAILURE_LIMIT:
            return _trigger('EDIT_OSCILLATION', chain, (item['sha256'] for item in chain),
                path=path, unchangedFailedChecks=failed)
        return None

    def budget(self, *, rounds, tokens, max_rounds, token_threshold, progress, unmet):
        if progress > 0 or not unmet:
            return None
        used = rounds * 5 > max_rounds * 3 or token_threshold is not None and tokens * 5 > token_threshold * 3
        if used:
            return _trigger('PROGRESSLESS_BURN', [self.last_observation] if self.last_observation else [],
                modelRequests=rounds, tokens=tokens, progress=progress)
        return None


def retain_snapshot(service, turn):
    """Retain the authorized text snapshot after the user chooses to stop."""
    current = snapshot(service.workspaces, turn['workspaceId'])
    directory = service.store.directory / 'agent-stall-snapshots'
    no_redirected_parents(directory)
    directory.mkdir(exist_ok=True)
    archive = directory / (turn['id'] + '-' + current['sha256'] + '.tar')
    archive_sha = hashlib.sha256(current['archive']).hexdigest()
    no_redirected_parents(archive)
    try:
        if not archive.exists():
            with NamedTemporaryFile(dir=directory, delete=False) as stream:
                temporary = stream.name
                stream.write(current['archive'])
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.replace(temporary, archive)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        with archive.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != archive_sha:
                fail('STALL_SNAPSHOT_INTEGRITY', '保存的停滞快照无法核对。', 409)
    except OSError:
        fail('STALL_SNAPSHOT_UNAVAILABLE', '无法保留当前文本快照。', 409)
    return {'snapshotSha256':current['sha256'], 'archiveSha256':archive_sha,
            'scope':current['manifest']['scope'], 'files':len(current['manifest']['files'])}
