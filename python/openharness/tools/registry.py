"""Tool registry — discover and manage tools."""

from __future__ import annotations

from openharness.core.exceptions import ToolNotFoundError
from openharness.core.types import ToolSpec

from .base import BaseTool


class ToolRegistry:
    """Central registry for tools."""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a tool instance."""
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool:
        """Get a tool by name. Raises ToolNotFoundError if not found."""
        if name in self._tools:
            return self._tools[name]
        raise ToolNotFoundError(f"Tool '{name}' not registered. Available: {self.names}")

    def list_specs(self) -> list[ToolSpec]:
        """Get tool specs for all registered tools (for sending to LLM)."""
        return [tool.to_spec() for tool in self._tools.values()]

    @property
    def names(self) -> list[str]:
        return sorted(self._tools.keys())

    @property
    def tools(self) -> list[BaseTool]:
        return list(self._tools.values())

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools
