import json
from pathlib import Path


def test_timeout_is_twenty():
    config = json.loads(Path("config.json").read_bytes())
    assert config["timeout"] == 20
