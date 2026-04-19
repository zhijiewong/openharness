"""End-to-end tests for OpenHarnessClient against a stubbed `oh session`."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

import pytest

from openharness import (
    OpenHarnessClient,
    OpenHarnessError,
    TextDelta,
    TurnComplete,
)

# The stub `oh session` emits a ready marker, then for each stdin line
# responds with id-tagged events. Installed via the conftest `make_oh_stub`
# fixture.
_STUB_SESSION = '''
import sys, json, time

sys.stdout.write(json.dumps({"type": "ready"}) + "\\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        continue
    if req.get("command") == "exit":
        break
    id_ = req.get("id", "")
    prompt = req.get("prompt", "")
    # Echo the prompt back as a text delta, then a turn_complete.
    for e in (
        {"id": id_, "type": "text", "content": f"echo: {prompt}"},
        {"id": id_, "type": "turn_complete", "reason": "completed"},
    ):
        sys.stdout.write(json.dumps(e) + "\\n")
        sys.stdout.flush()
'''


async def test_basic_send_receive(make_oh_stub: Callable[[str], Path]) -> None:
    make_oh_stub(_STUB_SESSION)
    async with OpenHarnessClient() as client:
        events: list = []
        async for e in await client.send("hello"):
            events.append(e)
        assert len(events) == 2
        assert isinstance(events[0], TextDelta)
        assert events[0].content == "echo: hello"
        assert isinstance(events[1], TurnComplete)


async def test_two_prompts_in_one_session(make_oh_stub: Callable[[str], Path]) -> None:
    make_oh_stub(_STUB_SESSION)
    async with OpenHarnessClient() as client:
        async for _ in await client.send("first"):
            pass
        events: list = []
        async for e in await client.send("second"):
            events.append(e)
        assert isinstance(events[0], TextDelta)
        assert events[0].content == "echo: second"


async def test_send_after_close_raises(make_oh_stub: Callable[[str], Path]) -> None:
    make_oh_stub(_STUB_SESSION)
    async with OpenHarnessClient() as client:
        async for _ in await client.send("warm up"):
            pass
    # Client is now closed.
    with pytest.raises(OpenHarnessError):
        await client.send("too late")


async def test_close_is_idempotent(make_oh_stub: Callable[[str], Path]) -> None:
    make_oh_stub(_STUB_SESSION)
    client = OpenHarnessClient()
    await client.__aenter__()
    await client.close()
    await client.close()  # second close: no-op, no error


async def test_serialized_sends(make_oh_stub: Callable[[str], Path]) -> None:
    """Concurrent sends on one client are serialized (lock-gated)."""
    make_oh_stub(_STUB_SESSION)
    async with OpenHarnessClient() as client:
        # Fire two .send() calls concurrently; both should complete without
        # interleaved events or errors.
        async def run_one(prompt: str) -> list:  # type: ignore[no-untyped-def]
            out: list = []
            async for e in await client.send(prompt):
                out.append(e)
            return out

        a, b = await asyncio.gather(run_one("alpha"), run_one("beta"))
        # Each got its own stream with its own echo.
        assert any(isinstance(e, TextDelta) and "alpha" in e.content for e in a)
        assert any(isinstance(e, TextDelta) and "beta" in e.content for e in b)
