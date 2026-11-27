"""User-selected turn modes and the tool policy enforced by the host."""
from .schemas import ApiError

COMMAND_GUIDANCE = {
    'plan': 'Read-only planning turn. Do not call file-writing or execution tools. The host rejects '
            'all change operations. Record the plan with update_plan and list execution prerequisites.',
    'goal': 'Track milestones with update_plan. At each milestone run the authorized fixed checks or verify '
            'the actual artifact bytes. Existing approvals, time limits and tool limits still apply.',
    'review': 'Read-only review turn. Do not call file-writing or execution tools. The host rejects '
              'all change operations. Inspect authorized evidence and report findings by severity.',
}

OBSERVATION_TOOLS = frozenset({
    'git_status', 'git_log', 'git_diff', 'project_overview', 'list_files', 'search',
    'read_file', 'read_document', 'inspect_changes', 'find_skills',
    'browser_read', 'browser_snapshot', 'update_plan',
})
READ_ONLY_COMMANDS = frozenset({'plan', 'review'})


def turn_command(prompt):
    word, *arguments = prompt.split(maxsplit=1)
    if word not in ('/plan', '/goal', '/review', '/compact'):
        return None
    if word in ('/plan', '/goal') and not arguments:
        raise ApiError('AGENT_COMMAND_ARGUMENT_REQUIRED', f'请在 {word} 后填写任务或目标。')
    if word == '/compact' and arguments:
        raise ApiError('AGENT_COMMAND_INVALID', '/compact 单独发送即可整理当前会话。')
    return word[1:]


def tool_allowed(command, name):
    return command != 'compact' and (command not in READ_ONLY_COMMANDS or name in OBSERVATION_TOOLS)
