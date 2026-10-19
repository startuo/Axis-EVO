"""Optional administrator-authorized routing to an exact gated preferred child."""
from axis_evo.skill_evolution_activation import resolve_preferred_skill, _eligibility
from axis_evo.skill_manager import SkillManager

from .runtime_policy import FILE_TOOLS


def enabled_skill_refs(connection, project):
    result = list(project.skill_refs)
    if not project.allow_evolved_skills:
        return result
    manager = SkillManager(connection)
    for skill_id in sorted({r.skill_id for r in project.skill_refs}):
        preferred = resolve_preferred_skill(connection, skill_id)
        if preferred is None or preferred in result:
            continue
        proof = _eligibility(connection, preferred)
        if proof['kind'] != 'GATED_PROMOTION':
            raise ValueError('An unconfigured preferred version requires a gated receipt')
        card = manager.get_version(preferred.skill_id, preferred.skill_version)
        cursor = card
        anchor = None
        # SkillManager verifies immutable cards and ancestry. Bound traversal
        # also prevents corrupt cycles from becoming a routing loop.
        for _ in range(128):
            if cursor.ref in project.skill_refs:
                anchor = cursor
                break
            if cursor.source.ref is None:
                break
            cursor = manager.get_version(cursor.source.ref.skill_id, cursor.source.ref.skill_version)
        if (anchor is None or anchor.skill_id != preferred.skill_id
                or not set(card.allowed_tools) <= set(anchor.allowed_tools) & set(FILE_TOOLS)):
            raise ValueError('Preferred lineage/capabilities are outside configured Runtime authority')
        result.append(preferred)
    return result
