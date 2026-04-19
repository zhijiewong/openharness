"""Streaming ``query()`` entry point.

Spawns the `oh` CLI as a subprocess and yields typed events as they arrive
from ``oh run --output-format stream-json``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
from collections.abc import AsyncIterator, Sequence
from typing import Literal

from ._binary import find_oh_binary
from .events import Event, parse_event
from .exceptions import OpenHarnessError

__all__ = ["query"]

PermissionMode = Literal["ask", "trust", "deny", "acceptEdits", "plan", "auto", "bypassPermissions"]


def _build_argv(
    oh: str,
    prompt: str,
    *,
    model: str | None,
    permission_mode: PermissionMode,
    allowed_tools: Sequence[str] | None,
    disallowed_tools: Sequence[str] | None,
    max_turns: int,
    system_prompt: str | None,
) -> list[str]:
    """Assemble the argv for ``oh run ... --output-format stream-json``."""
    argv: list[str] = [oh, "run", prompt, "--output-format", "stream-json"]
    if model:
        argv += ["--model", model]
    if permission_mode:
        argv += ["--permission-mode", permission_mode]
    if allowed_tools:
        argv += ["--allowed-tools", ",".join(allowed_tools)]
    if disallowed_tools:
        argv += ["--disallowed-tools", ",".join(disallowed_tools)]
    if max_turns is not None:
        argv += ["--max-turns", str(max_turns)]
    if system_prompt:
        argv += ["--system-prompt", system_prompt]
    return argv


async def query(
    prompt: str,
    *,
    model: str | None = None,
    permission_mode: PermissionMode = "trust",
    allowed_tools: Sequence[str] | None = None,
    disallowed_tools: Sequence[str] | None = None,
    max_turns: int = 20,
    system_prompt: str | None = None,
    cwd: str | os.PathLike[str] | None = None,
    env: dict[str, str] | None = None,
) -> AsyncIterator[Event]:
    """Run a single prompt through openHarness and stream events.

    Example::

        async for event in query("What is 2+2?", model="ollama/llama3", max_turns=1):
            print(event)

    :param prompt: The user prompt to send.
    :param model: Model string (e.g. ``"ollama/llama3"``, ``"claude-sonnet-4-6"``).
        When omitted, ``oh`` uses the model from ``.oh/config.yaml`` or env detection.
    :param permission_mode: One of the CLI-supported modes; ``"trust"`` by default so
        headless scripts don't hang on permission prompts.
    :param allowed_tools: Whitelist of tool names. When set, tools outside this list
        are blocked.
    :param disallowed_tools: Blacklist of tool names.
    :param max_turns: Maximum number of model turns before the session ends.
    :param system_prompt: Override the default system prompt.
    :param cwd: Working directory for the spawned CLI.
    :param env: Environment variables to pass to the CLI. Merged on top of
        ``os.environ``.

    :yields: Typed :class:`Event` objects matching NDJSON lines emitted by
        the CLI.

    :raises OhBinaryNotFoundError: if the ``oh`` CLI can't be located.
    :raises OpenHarnessError: if the subprocess exits non-zero.
    """
    oh = find_oh_binary()
    argv = _build_argv(
        oh,
        prompt,
        model=model,
        permission_mode=permission_mode,
        allowed_tools=allowed_tools,
        disallowed_tools=disallowed_tools,
        max_turns=max_turns,
        system_prompt=system_prompt,
    )

    merged_env = {**os.environ, **(env or {})}

    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        env=merged_env,
    )

    assert proc.stdout is not None
    try:
        async for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                # Non-JSON line (e.g. transient warning) — skip.
                continue
            yield parse_event(obj)
    except asyncio.CancelledError:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError, OSError):
                proc.send_signal(signal.SIGTERM if os.name != "nt" else signal.SIGBREAK)
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except TimeoutError:
                proc.kill()
        raise
    finally:
        rc = await proc.wait()
        if rc != 0:
            stderr = ""
            if proc.stderr is not None:
                with contextlib.suppress(Exception):
                    stderr_bytes = await proc.stderr.read()
                    stderr = stderr_bytes.decode(errors="replace")
            raise OpenHarnessError(
                f"'oh run' exited with code {rc}",
                stderr=stderr,
                exit_code=rc,
            )
