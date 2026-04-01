"""MCP (Model Context Protocol) types for OpenHarness."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class MCPServerConfig:
    """Configuration for connecting to an MCP server."""

    name: str
    command: str  # e.g., "npx", "python"
    args: list[str] = field(default_factory=list)  # e.g., ["-y", "@modelcontextprotocol/server-github"]
    env: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class MCPTool:
    """A tool exposed by an MCP server."""

    name: str
    description: str
    input_schema: dict[str, Any]
    server_name: str


@dataclass(frozen=True)
class MCPResource:
    """A resource exposed by an MCP server."""

    uri: str
    name: str
    description: str = ""
    mime_type: str = ""


@dataclass(frozen=True)
class MCPToolResult:
    """Result from calling an MCP tool."""

    content: str
    is_error: bool = False
