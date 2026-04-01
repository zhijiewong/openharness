"""Streaming event types for the agent loop."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Union


@dataclass(frozen=True)
class TextDelta:
    """A chunk of streamed text from the LLM."""

    content: str


@dataclass(frozen=True)
class ToolCallStart:
    """LLM has requested a tool call."""

    tool_name: str
    call_id: str


@dataclass(frozen=True)
class ToolCallEnd:
    """A tool call has finished executing."""

    call_id: str
    output: str
    is_error: bool = False


@dataclass(frozen=True)
class PermissionRequest:
    """Agent is asking for user permission to run a tool."""

    tool_name: str
    call_id: str
    arguments: dict
    risk_level: str


@dataclass(frozen=True)
class CostUpdate:
    """Token usage and cost for an API call."""

    input_tokens: int
    output_tokens: int
    cost: float
    model: str


@dataclass(frozen=True)
class TurnComplete:
    """The agent has finished its turn (no more tool calls)."""

    reason: str  # "completed", "aborted", "max_turns", "error"


@dataclass(frozen=True)
class ErrorEvent:
    """An error occurred during the agent loop."""

    message: str
    recoverable: bool = False


# Union type for all events that can be yielded by the agent loop
Event = Union[
    TextDelta,
    ToolCallStart,
    ToolCallEnd,
    PermissionRequest,
    CostUpdate,
    TurnComplete,
    ErrorEvent,
]
