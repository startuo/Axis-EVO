"""Opt-in real provider smoke. Execution requires a separately supplied digest."""
import argparse
import json
from pathlib import Path

from axis_evo.skill_card import SkillRef
from web_api.provider_store import ProviderStore
from web_api.runtime_config import RuntimeConfig
from web_api.runtime_service import RuntimeService
from web_api.schemas import WorkbenchConfig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbench-config', type=Path, required=True)
    parser.add_argument('--runtime-config', type=Path, required=True)
    parser.add_argument('--phase', choices=('connection', 'plan', 'execute', 'inspect'), required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--profile-id')
    parser.add_argument('--profile-revision', type=int)
    parser.add_argument('--skill-id')
    parser.add_argument('--skill-version', type=int)
    parser.add_argument('--prompt')
    parser.add_argument('--thread-id')
    parser.add_argument('--approved-plan-sha256')
    parser.add_argument('--live-provider', action='store_true', help='Explicitly permit provider network I/O')
    args = parser.parse_args()
    if args.phase in ('connection', 'plan') and not args.live_provider:
        parser.error('Network smoke requires --live-provider; automated tests must stay offline')
    workbench = WorkbenchConfig.from_file(args.workbench_config)
    config = RuntimeConfig.from_file(args.runtime_config, workbench)
    providers = ProviderStore(config)
    if args.phase == 'connection':
        if not args.profile_id or not args.profile_revision:
            parser.error('An exact configured provider revision is required')
        print(json.dumps(providers.test(args.profile_id, args.profile_revision), ensure_ascii=False, indent=2))
        return
    service = RuntimeService(config, workbench, providers)
    try:
        if args.phase == 'plan':
            if not all((args.profile_id, args.profile_revision, args.skill_id, args.skill_version, args.prompt)):
                parser.error('Planning requires exact profile/Skill revisions and a bounded prompt')
            thread = service.create_thread(args.project, {'prompt': args.prompt, 'profileId': args.profile_id,
                'profileRevision': args.profile_revision, 'skillRef': SkillRef(args.skill_id, args.skill_version).to_dict()})
            result = service.wait(args.project, thread['id'], timeout=320)
        else:
            if not args.thread_id:
                parser.error('An existing thread ID is required')
            result = service.get_thread(args.project, args.thread_id)
            if args.phase == 'execute':
                if not args.approved_plan_sha256:
                    parser.error('Review the persisted Plan and supply its exact --approved-plan-sha256')
                service.approve(args.project, args.thread_id, {'proposalId': result['proposalId'],
                    'approvedPlanSha256': args.approved_plan_sha256})
                result = service.wait(args.project, args.thread_id, timeout=100)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        service.close()


if __name__ == '__main__':
    main()
