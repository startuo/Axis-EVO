"""Private worker entry point: identifiers and pinned config, never shell text."""
import json
from pathlib import Path
import re
import sys

from .provider_store import ProviderStore
from .runtime_config import RuntimeConfig, RuntimeProject
from .runtime_service import RuntimeService
from .runtime_jobs import claim
from .schemas import Project, WorkbenchConfig, strict_json
from axis_evo.skill_card import SkillRef


def run_worker(descriptor_path, phase, job, worker, dispatch):
    if phase not in ('planning', 'execution') or not re.fullmatch('thread_[0-9a-f]{32}', job) or not re.fullmatch('worker_[0-9a-f]{32}', worker):
        raise ValueError('invalid worker identity')
    value = strict_json(Path(descriptor_path).read_bytes())
    wb = value['workbench']
    workbench = WorkbenchConfig(tuple(Project.from_dict(p) for p in wb['projects']), tuple(wb['allowed_origins']))
    rc = value['runtime']
    config = RuntimeConfig(Path(rc['data_dir']), tuple(RuntimeProject(p['id'], Path(p['task_spec_path']),
        tuple(SkillRef(**r) for r in p['skill_refs']),
        tuple((name, Path(path)) for name, path in p.get('task_templates', {}).items())) for p in rc['projects']), rc['credentials'], tuple(rc['endpoints']))
    service = RuntimeService(config, workbench, ProviderStore(config), worker_mode=True)
    row = service._row_unscoped(job)
    with service._web() as c:
        claim(c, job, phase, worker, None if dispatch == '-' else dispatch)
    if phase == 'planning':
        service._plan(row)
    else:
        service._execute(row)


if __name__ == '__main__':
    run_worker(*sys.argv[1:])
