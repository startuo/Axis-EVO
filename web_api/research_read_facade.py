"""Read only administrator-placed disposable experiments under a fixed root."""
import re

from axis_evo.agent_episode_storage import _absolute_directory
from axis_evo.research_runner import inspect_research_experiment, research_source_identity


def research_readiness(service, project_id):
    service.runtime._project(project_id)
    root = service.runtime.config.data_dir / 'research' / project_id
    experiments = []
    if root.exists() or root.is_symlink():
        root = _absolute_directory(root.absolute())
        paths = sorted(root.iterdir(), key=lambda path: path.name)
        if len(paths) > 8:
            raise ValueError('Research inspection supports at most eight declared experiment directories')
        for path in paths:
            if not re.fullmatch('experiment_[0-9a-f]{32}', path.name):
                raise ValueError('Unexpected administrator research directory identity')
            report = inspect_research_experiment(_absolute_directory(path.absolute()))
            if report['experimentId'] != path.name:
                raise ValueError('Research directory and committed experiment identity mismatch')
            experiments.append(report)
    return {'schemaVersion': 1, 'mode': 'READ_ONLY_RESEARCH_EVIDENCE',
        'sourceTreeSha256': research_source_identity()['sha256'],
        'formalHoldoutStatus': 'NOT_FROZEN_NOT_RUN', 'livePilotStatus': 'NOT_CERTIFIED_BY_THIS_VIEW',
        'datasetRoles': ['DEVELOPMENT', 'GATE', 'FINAL_HOLDOUT'],
        'protocolApproval': 'EXACT_PROTOCOL_SHA256_REQUIRED',
        'productionDatabaseWrites': False, 'browserExecutionAvailable': False,
        'experiments': experiments, 'tokenUsageStatus': 'TOKEN_USAGE_UNAVAILABLE',
        'limitations': ['Engineering fixtures do not establish heldout generalization.',
            'Dataset, Oracle, candidate pool, effective model configuration and source must be frozen before formal research.',
            'Same-account local filesystem access is not cryptographic holdout blindness.']}
