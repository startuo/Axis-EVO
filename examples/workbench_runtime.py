"""Prepare a new local file-only example; never overwrite an existing project.

Run from the repository root with python -m examples.workbench_runtime.
The explicit flag admits an example Skill using the legacy caller-controlled
lifecycle. This is not a trust assessment or governed promotion receipt.
"""
import argparse
import json
from pathlib import Path

from axis_evo.planning_provenance import initialize_skill_planning_schema
from axis_evo.skill_binding import initialize_skill_binding_schema
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_storage import initialize_skill_schema
from axis_evo.storage import connect_database
from web_api.schemas import no_redirected_parents


def prepare(path):
    base = Path(path).absolute()
    no_redirected_parents(base)
    base.mkdir(parents=True, exist_ok=False)
    base = base.resolve(strict=True)
    data, assets = base / "data", base / "assets"
    data.mkdir()
    (assets / "seed").mkdir(parents=True)
    (assets / "seed/config.txt").write_bytes(b"timeout=10\n")
    task = {"schema_version": 1, "task_id": "timeout-example", "title": "Timeout configuration",
        "goal": "Change timeout from 10 to 20", "workspace": {"seed_dir": "seed"},
        "acceptance": {"pytest": {"enabled": False, "args": []}, "file_assertions": [
            {"path": "config.txt", "operator": "equals", "expected": "timeout=20\n"}]}}
    (assets / "task.json").write_text(json.dumps(task, indent=2), encoding="utf-8")
    database = base / "core.sqlite3"
    connection = connect_database(database)
    try:
        initialize_skill_schema(connection)
        initialize_skill_binding_schema(connection)
        initialize_skill_planning_schema(connection)
        manager = SkillManager(connection)
        card = manager.create_version("configuration.patch", name="Configuration patch", description="Local example",
            instructions="Patch config.txt from timeout=10 to timeout=20 exactly once. "
                         "Independent file Acceptance, not tool success, determines completion.",
            allowed_tools=["read_file", "write_file", "patch_file"])
        manager.promote(card.skill_id, 1, "SHADOW")
        manager.promote(card.skill_id, 1, "TRUSTED")
    finally:
        connection.close()
    configs = {"workbench.json": {"projects": [{"id": "configuration", "name": "Local configuration",
        "database": str(database), "workspace_roots": [str(data)]}]}, "runtime.json": {
        "data_dir": str(data), "projects": [{"id": "configuration", "task_spec_path": str(assets / "task.json"),
        "skill_refs": [card.ref.to_dict()]}], "credentials": {
            "primary": "AXIS_EVO_API_KEY", "deepseek": "AXIS_EVO_DEEPSEEK_API_KEY"}}}
    for name, value in configs.items():
        (base / name).write_text(json.dumps(value, indent=2), encoding="utf-8")
    return base


def main():
    parser = argparse.ArgumentParser(description="Prepare an isolated file-only Web runtime example")
    parser.add_argument("--data-dir", type=Path, default=Path(".local/workbench-runtime"))
    parser.add_argument("--admit-example-skill", action="store_true",
        help="Explicitly admit the example Skill through the legacy caller-controlled lifecycle")
    args = parser.parse_args()
    if not args.admit_example_skill:
        parser.error("--admit-example-skill is required; this example does not assess Skill trust")
    try:
        base = prepare(args.data_dir)
    except (OSError, ValueError):
        parser.error("A new, unredirected output directory is required; existing data was not overwritten")
    print("Prepared local example:", base)
    print("Manual example admission only; no Trust Evaluator evidence or model request was produced.")
    print("Configure the selected credential environment variable in the server terminal; never in the browser.")


if __name__ == "__main__":
    main()
