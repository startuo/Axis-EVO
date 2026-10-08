import json
from pathlib import Path

import pytest

from axis_evo.storage import connect_database
from axis_evo.task_spec import load_task_spec


@pytest.fixture
def task_path():
    return Path(__file__).parent / "fixtures" / "tasks" / "demo_config_001.json"


@pytest.fixture
def task_data(task_path):
    return json.loads(task_path.read_text(encoding="utf-8"))


@pytest.fixture
def task_spec(task_path):
    return load_task_spec(task_path)


@pytest.fixture
def database(tmp_path):
    connection = connect_database(tmp_path / "facts.sqlite3")
    try:
        yield connection
    finally:
        connection.close()
