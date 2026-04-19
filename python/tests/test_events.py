"""Tests for openharness.events."""

from __future__ import annotations

import pytest

from openharness.events import (
    CostUpdate,
    ErrorEvent,
    TextDelta,
    ToolEnd,
    ToolStart,
    TurnComplete,
    UnknownEvent,
    parse_event,
)


def test_parse_text_delta() -> None:
    e = parse_event({"type": "text", "content": "hello"})
    assert isinstance(e, TextDelta)
    assert e.content == "hello"


def test_parse_tool_start() -> None:
    e = parse_event({"type": "tool_start", "tool": "Bash"})
    assert isinstance(e, ToolStart)
    assert e.tool == "Bash"


def test_parse_tool_end() -> None:
    e = parse_event({"type": "tool_end", "tool": "Bash", "output": "ok", "error": False})
    assert isinstance(e, ToolEnd)
    assert e.tool == "Bash"
    assert e.output == "ok"
    assert e.error is False


def test_parse_tool_end_error() -> None:
    e = parse_event({"type": "tool_end", "tool": "Bash", "output": "boom", "error": True})
    assert isinstance(e, ToolEnd)
    assert e.error is True


def test_parse_error() -> None:
    e = parse_event({"type": "error", "message": "rate limited"})
    assert isinstance(e, ErrorEvent)
    assert e.message == "rate limited"


def test_parse_cost_update() -> None:
    e = parse_event(
        {
            "type": "cost_update",
            "inputTokens": 100,
            "outputTokens": 50,
            "cost": 0.0025,
            "model": "claude-sonnet-4-6",
        }
    )
    assert isinstance(e, CostUpdate)
    assert e.input_tokens == 100
    assert e.output_tokens == 50
    assert e.cost == pytest.approx(0.0025)
    assert e.model == "claude-sonnet-4-6"


def test_parse_turn_complete() -> None:
    e = parse_event({"type": "turn_complete", "reason": "completed"})
    assert isinstance(e, TurnComplete)
    assert e.reason == "completed"


def test_parse_unknown_type_returns_unknown_event() -> None:
    raw = {"type": "future_event", "whatever": 42}
    e = parse_event(raw)
    assert isinstance(e, UnknownEvent)
    assert e.raw == raw


def test_parse_missing_type_returns_unknown_event() -> None:
    e = parse_event({"content": "oops"})
    assert isinstance(e, UnknownEvent)


def test_parse_non_dict_raises() -> None:
    with pytest.raises(TypeError):
        parse_event("not a dict")  # type: ignore[arg-type]


def test_events_are_frozen() -> None:
    e = TextDelta(content="x")
    with pytest.raises(Exception):  # dataclasses.FrozenInstanceError
        e.content = "y"  # type: ignore[misc]
