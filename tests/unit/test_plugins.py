from dataclasses import dataclass

import pytest

from axis_evo.plugins import PluginRegistry


@dataclass
class ExamplePlugin:
    name: str


def test_plugin_registry_registration_and_retrieval():
    plugin = ExamplePlugin("deterministic")
    registry = PluginRegistry()
    registry.register(plugin)
    assert registry.get("deterministic") is plugin


def test_plugin_registry_rejects_duplicate_registration():
    registry = PluginRegistry()
    original = ExamplePlugin("duplicate")
    registry.register(original)
    with pytest.raises(ValueError, match="already registered"):
        registry.register(ExamplePlugin("duplicate"))
    assert registry.get("duplicate") is original


def test_plugin_registry_unknown_name():
    with pytest.raises(KeyError):
        PluginRegistry().get("missing")


@pytest.mark.parametrize("name", ["", " ", 123])
def test_plugin_registry_rejects_invalid_names(name):
    with pytest.raises(ValueError):
        PluginRegistry().register(ExamplePlugin(name))
