"""Bounded, hash-pinned research data; no model, execution or write authority."""
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re

from .agent_episode_storage import _absolute_directory, seed_manifest
from .evaluation_campaign import _profile
from .hashing import canonical_json_bytes
from .planning_adapter import _strict_json
from .sandbox import Sandbox
from .shadow_evaluation import FILE_TOOLS, _encoded, _case_value
from .skill_evolution_storage import _keys, _hash, _text, digest
from .skill_planner import _task_data
from .task_spec import task_spec_from_dict

MAX_DATASET_BYTES = 256 * 1024
MAX_DATASET_CASES = 32
ROLES = ('DEVELOPMENT', 'GATE', 'FINAL_HOLDOUT')
TOOL_POLICY_ID = 'portable-file-simulation-v1'


def _identity(value):
    if type(value) is not str or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', value) is None:
        raise ValueError('Research identity must be bounded portable ASCII')
    return value


def _relative(value):
    _text(value, 512)
    from .skill_planner import _static_path
    _static_path(value)
    path = PurePosixPath(value)
    if '\\' in value or any(p in ('', '.', '..') for p in value.split('/')) or path.as_posix() != value:
        raise ValueError('Research data paths must be canonical relative paths')
    return value


def _read(sandbox, relative, limit=MAX_DATASET_BYTES):
    path = sandbox.resolve(_relative(relative))
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Research data exceeds byte budget')
    return _strict_json(data.decode('utf-8', errors='strict'), limit)


@dataclass(frozen=True)
class ResearchDataset:
    root: str
    manifest_json: str
    manifest_sha256: str

    @property
    def data(self):
        return _strict_json(self.manifest_json, MAX_DATASET_BYTES)


def _manifest(value):
    _keys(value, ('schema_version', 'dataset_id', 'dataset_version', 'data_status', 'created_at', 'cases'))
    if type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError('Unsupported dataset schema')
    _identity(value['dataset_id'])
    _text(value['created_at'], 128)
    if type(value['dataset_version']) is not int or value['dataset_version'] < 1:
        raise ValueError('Dataset version must be a positive integer')
    if value['data_status'] not in ('ENGINEERING_FIXTURE', 'RESEARCH_DATA'):
        raise ValueError('Dataset must distinguish engineering from research data')
    if type(value['cases']) is not list or not 1 <= len(value['cases']) <= MAX_DATASET_CASES:
        raise ValueError('Dataset case budget exceeded')
    ids, families, paths, fingerprints = set(), {}, set(), {}
    for case in value['cases']:
        _keys(case, ('case_id', 'task_family', 'case_role', 'task_spec_path', 'task_spec_sha256',
            'seed_path', 'seed_manifest_sha256', 'oracle_path', 'oracle_sha256',
            'tool_policy_id', 'allowed_tools', 'model_profile_identity', 'execution_budget'))
        cid, family, role = _identity(case['case_id']), _identity(case['task_family']), case['case_role']
        if cid in ids or role not in ROLES:
            raise ValueError('Duplicate case or unsupported role')
        ids.add(cid)
        if family in families and families[family] != role:
            raise ValueError('A task family cannot cross dataset roles')
        families[family] = role
        for name in ('task_spec', 'seed_manifest', 'oracle'):
            _hash(case[name + '_sha256'])
        for name in ('task_spec_path', 'seed_path', 'oracle_path'):
            path = _relative(case[name])
            if path in paths:
                raise ValueError('Dataset cases cannot alias private input paths')
            paths.add(path)
        fingerprint = (case['seed_manifest_sha256'], case['oracle_sha256'])
        if fingerprint in fingerprints and fingerprints[fingerprint] != role:
            raise ValueError('Identical seed/Oracle evidence cannot cross dataset roles')
        fingerprints[fingerprint] = role
        tools = case['allowed_tools']
        if (case['tool_policy_id'] != TOOL_POLICY_ID or type(tools) is not list or not tools
                or tools != sorted(set(tools)) or any(t not in FILE_TOOLS for t in tools)):
            raise ValueError('Research supports exact portable file-tool simulation only')
        _profile(case['model_profile_identity'])
        budget = case['execution_budget']
        _keys(budget, ('model_calls', 'max_response_bytes', 'max_plan_steps'))
        if any(type(budget[k]) is not int for k in budget) or budget != {
                'model_calls': 1, 'max_response_bytes': 65536, 'max_plan_steps': 10}:
            raise ValueError('Unsupported research execution budget')
    return value


def load_research_dataset(root, manifest_path):
    """Verify all private identities locally; never transmit Oracle contents."""
    root = _absolute_directory(Path(root).absolute())
    sandbox = Sandbox(root)
    envelope = _read(sandbox, manifest_path)
    _keys(envelope, ('manifest', 'dataset_manifest_sha256'))
    value = _manifest(envelope['manifest'])
    if digest(value) != envelope['dataset_manifest_sha256']:
        raise ValueError('Dataset manifest digest mismatch')
    data = ResearchDataset(str(root), canonical_json_bytes(value).decode('utf-8'), digest(value))
    for case in value['cases']:
        # Real holdout identities remain in the manifest without opening their
        # private bytes during revision/development. Engineering split fixtures
        # may validate all roles; they are explicitly not formal holdout data.
        if case['case_role'] != 'FINAL_HOLDOUT' or value['data_status'] == 'ENGINEERING_FIXTURE':
            load_research_case(data, case['case_id'])
    return data


def load_research_case(dataset, case_id):
    """Recheck actual bytes on every use, including after a controller restart."""
    if type(dataset) is not ResearchDataset or digest(_manifest(dataset.data)) != dataset.manifest_sha256:
        raise ValueError('Research dataset identity changed')
    matches = [c for c in dataset.data['cases'] if c['case_id'] == case_id]
    if len(matches) != 1:
        raise ValueError('Case is not declared in the frozen dataset')
    if matches[0]['case_role'] == 'FINAL_HOLDOUT' and dataset.data['data_status'] != 'ENGINEERING_FIXTURE':
        raise ValueError('Real final holdout cannot be opened by revision/development infrastructure in this milestone')
    case, sandbox = matches[0], Sandbox(_absolute_directory(Path(dataset.root)))
    task_data = _read(sandbox, case['task_spec_path'])
    task = task_spec_from_dict(task_data)
    oracle = _read(sandbox, case['oracle_path'])
    seed = sandbox.resolve(case['seed_path'])
    manifest_json, seed_sha = seed_manifest(seed)
    expected_seed = (sandbox.resolve(case['task_spec_path']).parent / task.workspace['seed_dir']).absolute()
    # Reject aliases before resolution; the TaskSpec must name this exact seed.
    _relative(task.workspace['seed_dir'])
    if expected_seed != Path(seed):
        raise ValueError('TaskSpec and dataset seed identity mismatch')
    if (digest(_task_data(task)) != case['task_spec_sha256'] or digest(oracle) != case['oracle_sha256']
            or seed_sha != case['seed_manifest_sha256']):
        raise ValueError('TaskSpec, seed or Oracle digest identity mismatch')
    entries = _strict_json(manifest_json, MAX_DATASET_BYTES)['entries']
    seed_box, files = Sandbox(seed), {}
    for entry in entries:
        if entry['type'] == 'file':
            with seed_box.resolve(entry['path']).open('rb') as stream:
                raw = stream.read(65537)
            if len(raw) > 65536:
                raise ValueError('Simulator seed file exceeds byte budget')
            files[entry['path']] = raw
    # Same canonical seed definition as the existing Shadow evaluator, with a
    # separately recorded filesystem-manifest hash (these are different objects).
    definition = {'case_id': case_id, 'case_version': 1, 'task_spec': task_data,
                  'initial_files': _encoded(files), 'oracle': oracle}
    _case_value('research-data-validation', definition)
    if seed_manifest(seed)[1] != seed_sha:
        raise ValueError('Seed identity changed while reading research inputs')
    return {'definition': definition, 'seed_manifest_sha256': seed_sha,
            'shadow_seed_sha256': digest(definition['initial_files']), 'seed_path': str(seed), 'metadata': case}
