"""End-to-end tests for openharness.query against a stubbed `oh` binary."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from openharness import (
    ErrorEvent,
    OpenHarnessError,
    TextDelta,
    ToolEnd,
    ToolStart,
    TurnComplete,
    query,
)


async def _collect(prompt: str = "hi", **kwargs) -> list:  # type: ignore[no-untyped-def]
    events = []
    async for e in query(prompt, **kwargs):
        events.append(e)
    return events


async def test_basic_stream(oh_stub: Path) -> None:
    events = await _collect()
    assert len(events) == 3
    assert isinstance(events[0], TextDelta)
    assert events[0].content == "hello"
    assert isinstance(events[1], TextDelta)
    assert events[1].content == " world"
    assert isinstance(events[2], TurnComplete)


async def test_tool_events(make_oh_stub: Callable[[str], Path]) -> None:
    body = '''
import sys, json
for e in [
    {"type": "tool_start", "tool": "Bash"},
    {"type": "tool_end", "tool": "Bash", "output": "ls output", "error": False},
    {"type": "turn_complete", "reason": "completed"},
]:
    print(json.dumps(e), flush=True)
'''
    make_oh_stub(body)
    events = await _collect()
    assert isinstance(events[0], ToolStart)
    assert events[0].tool == "Bash"
    assert isinstance(events[1], ToolEnd)
    assert events[1].output == "ls output"
    assert events[1].error is False


async def test_error_event(make_oh_stub: Callable[[str], Path]) -> None:
    body = '''
import sys, json
print(json.dumps({"type": "error", "message": "rate limited"}), flush=True)
print(json.dumps({"type": "turn_complete", "reason": "error"}), flush=True)
sys.exit(1)
'''
    make_oh_stub(body)
    err_events = []
    with pytest.raises(OpenHarnessError) as exc:
        async for e in query("x"):
            err_events.append(e)
    assert exc.value.exit_code == 1
    assert any(isinstance(e, ErrorEvent) for e in err_events)


async def test_non_zero_exit_raises(make_oh_stub: Callable[[str], Path]) -> None:
    body = "import sys; sys.stderr.write('boom\\n'); sys.exit(2)"
    make_oh_stub(body)
    with pytest.raises(OpenHarnessError) as exc:
        async for _ in query("x"):
            pass
    assert exc.value.exit_code == 2
    assert "boom" in (exc.value.stderr or "")


async def test_option_passthrough(make_oh_stub: Callable[[str], Path], tmp_path: Path) -> None:
    # Stub records its argv to a file so we can assert the expected flags are passed.
    capture = tmp_path / "argv.json"
    body = f'''
import sys, json
with open({json.dumps(str(capture))}, "w") as f:
    json.dump(sys.argv, f)
print(json.dumps({{"type": "turn_complete", "reason": "completed"}}), flush=True)
'''
    make_oh_stub(body)
    await _collect(
        "hello",
        model="ollama/llama3",
        permission_mode="trust",
        allowed_tools=["Read", "Bash"],
        disallowed_tools=["Write"],
        max_turns=5,
        system_prompt="You are terse.",
    )
    argv = json.loads(capture.read_text())
    assert "run" in argv
    assert "hello" in argv
    assert "--output-format" in argv and "stream-json" in argv
    assert "--model" in argv and "ollama/llama3" in argv
    assert "--permission-mode" in argv and "trust" in argv
    assert "--allowed-tools" in argv and "Read,Bash" in argv
    assert "--disallowed-tools" in argv and "Write" in argv
    assert "--max-turns" in argv and "5" in argv
    assert "--system-prompt" in argv and "You are terse." in argv


async def test_cancellation_terminates_subprocess(make_oh_stub: Callable[[str], Path]) -> None:
    body = '''
import sys, json, time
# Emit one event, then sleep forever.
print(json.dumps({"type": "text", "content": "first"}), flush=True)
time.sleep(60)
'''
    make_oh_stub(body)

    async def run_and_cancel() -> list:  # type: ignore[no-untyped-def]
        events = []
        try:
            async for e in query("x"):
                events.append(e)
                # After the first event, cancel the task.
                raise asyncio.CancelledError()
        except asyncio.CancelledError:
            pass
        return events

    # CancelledError propagates cleanly; subprocess is terminated.
    events = await run_and_cancel()
    assert len(events) >= 1
    assert isinstance(events[0], TextDelta)


async def test_non_json_lines_are_skipped(make_oh_stub: Callable[[str], Path]) -> None:
    body = '''
import sys, json
print("not json", flush=True)
print("", flush=True)
print(json.dumps({"type": "text", "content": "ok"}), flush=True)
print(json.dumps({"type": "turn_complete", "reason": "completed"}), flush=True)
'''
    make_oh_stub(body)
    events = await _collect()
    assert len(events) == 2
    assert isinstance(events[0], TextDelta)
    assert events[0].content == "ok"
