"""Core types for OpenHarness — messages, tool calls, tool specs, model info."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4


class Role(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# ---------------------------------------------------------------------------
# Tool call / result types (frozen, immutable value objects)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolCall:
    """An LLM's request to invoke a tool."""

    id: str
    tool_name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    """Result returned by a tool execution."""

    call_id: str
    output: str
    is_error: bool = False


# ---------------------------------------------------------------------------
# Message
# ---------------------------------------------------------------------------


@dataclass
class Message:
    """A single message in a conversation."""

    role: Role
    content: str
    tool_calls: tuple[ToolCall, ...] = ()
    tool_results: tuple[ToolResult, ...] = ()
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    uuid: str = field(default_factory=lambda: uuid4().hex)

    # Convenience flag for meta/system messages that should be hidden from API
    is_meta: bool = False


# ---------------------------------------------------------------------------
# Tool specification (sent to the LLM so it knows what tools are available)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolSpec:
    """Description of a tool, sent to the LLM in the tool-use protocol."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema
    risk_level: RiskLevel = RiskLevel.LOW

    def to_api_dict(self) -> dict[str, Any]:
        """Convert to the dict format expected by LLM APIs."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# ---------------------------------------------------------------------------
# Model information
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelInfo:
    """Metadata about an LLM model."""

    id: str
    provider: str
    context_window: int = 8192
    supports_tools: bool = False
    supports_streaming: bool = True
    supports_vision: bool = False
    input_cost_per_mtok: float = 0.0  # USD per million input tokens
    output_cost_per_mtok: float = 0.0  # USD per million output tokens


# ---------------------------------------------------------------------------
# Permission result
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PermissionResult:
    """Outcome of a permission check for a tool call."""

    allowed: bool
    reason: str = ""  # "auto-approved", "user-approved", "denied", "rule"
    risk_level: RiskLevel = RiskLevel.LOW
