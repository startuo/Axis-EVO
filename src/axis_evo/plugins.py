"""Explicit in-process registration, with no discovery or persistence access."""

from typing import Protocol


class Plugin(Protocol):
    name: str


class PluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, Plugin] = {}

    def register(self, plugin: Plugin) -> None:
        if not isinstance(plugin.name, str) or not plugin.name.strip():
            raise ValueError("plugin name must be a nonempty string")
        if plugin.name in self._plugins:
            raise ValueError(f"plugin already registered: {plugin.name}")
        self._plugins[plugin.name] = plugin

    def get(self, name: str) -> Plugin:
        return self._plugins[name]
