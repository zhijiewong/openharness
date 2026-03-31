"""Hook system — lifecycle hooks that run shell commands on agent events.

Mirrors Claude Code's hook system: register shell commands to run before/after
tool calls, on session start/end, file changes, errors, and cost thresholds.
"""

from __future__ import annotations

import asyncio
import logging
import shlex
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


class HookEvent(str, Enum):
    PRE_TOOL_USE = "PreToolUse"
    POST_TOOL_USE = "PostToolUse"
    SESSION_START = "SessionStart"
    SESSION_END = "SessionEnd"
    ON_FILE_EDIT = "OnFileEdit"
    ON_FILE_CREATE = "OnFileCreate"
    ON_ERROR = "OnError"
    ON_COST_THRESHOLD = "OnCostThreshold"


@dataclass
class HookConfig:
    """Configuration for a single hook."""

    event: HookEvent
    command: str  # Shell command to execute
    matcher: str | None = None  # Tool name pattern (e.g., "Bash", "Write")
    if_condition: str | None = None  # Permission-rule syntax filter
    blocking: bool = True  # Wait for completion
    timeout: int = 30  # Seconds
    once: bool = False  # Remove after first execution


@dataclass(frozen=True)
class HookResult:
    """Result of a single hook execution."""

    success: bool
    output: str
    exit_code: int = 0
    blocking_error: str | None = None
    prevent_continuation: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _substitute_context(command: str, context: dict[str, Any]) -> str:
    """Replace {file}, {tool_name}, etc. placeholders in a command string.

    All substituted values are shell-escaped to prevent command injection.
    """
    import shlex

    result = command
    for key, value in context.items():
        result = result.replace(f"{{{key}}}", shlex.quote(str(value)))
    return result


def _matches_tool(matcher: str | None, tool_name: str | None) -> bool:
    """Check whether a matcher pattern matches the given tool name.

    A ``None`` matcher matches everything.  Otherwise it is compared
    case-insensitively against *tool_name*.  A trailing ``*`` enables
    prefix matching.
    """
    if matcher is None:
        return True
    if tool_name is None:
        return False
    matcher_lower = matcher.lower()
    tool_lower = tool_name.lower()
    if matcher_lower.endswith("*"):
        return tool_lower.startswith(matcher_lower[:-1])
    return matcher_lower == tool_lower


# ---------------------------------------------------------------------------
# HookSystem
# ---------------------------------------------------------------------------

class HookSystem:
    """Manage and execute lifecycle hooks."""

    def __init__(self) -> None:
        self._hooks: dict[str, list[HookConfig]] = {}

    def register(self, hook: HookConfig) -> None:
        """Register a hook for its event."""
        key = hook.event.value
        self._hooks.setdefault(key, []).append(hook)

    def load_from_yaml(self, path: Path) -> int:
        """Load hooks from a YAML file (typically ``.oh/hooks.yaml``).

        Expected format::

            hooks:
              PreToolUse:
                - matcher: "Bash"
                  command: "echo 'About to run bash'"
                  blocking: true
              PostToolUse:
                - matcher: "Write"
                  command: "prettier --write {file}"

        Returns count of hooks loaded.
        """
        if not path.is_file():
            return 0

        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            logger.warning("Failed to load hooks from %s: %s", path, exc)
            return 0

        hooks_section = raw.get("hooks", {})
        if not isinstance(hooks_section, dict):
            return 0

        count = 0
        for event_name, hook_list in hooks_section.items():
            try:
                event = HookEvent(event_name)
            except ValueError:
                logger.warning("Unknown hook event: %s", event_name)
                continue

            if not isinstance(hook_list, list):
                continue

            for entry in hook_list:
                if not isinstance(entry, dict) or "command" not in entry:
                    continue
                hook = HookConfig(
                    event=event,
                    command=entry["command"],
                    matcher=entry.get("matcher"),
                    if_condition=entry.get("if"),
                    blocking=entry.get("blocking", True),
                    timeout=entry.get("timeout", 30),
                    once=entry.get("once", False),
                )
                self.register(hook)
                count += 1

        return count

    async def trigger(
        self, event: HookEvent, context: dict[str, Any] | None = None
    ) -> list[HookResult]:
        """Run all hooks registered for *event*.

        *context* supplies substitution values (``tool_name``, ``file``, etc.)
        and is used for matcher checks.

        Non-blocking hooks are launched concurrently; blocking hooks are
        awaited in registration order.  Returns a list of results.
        """
        context = context or {}
        key = event.value
        hooks = self._hooks.get(key, [])
        if not hooks:
            return []

        tool_name = context.get("tool_name")
        results: list[HookResult] = []
        to_remove: list[HookConfig] = []

        for hook in hooks:
            # Check matcher against tool name
            if not _matches_tool(hook.matcher, tool_name):
                continue

            cmd = _substitute_context(hook.command, context)
            result = await self._run_command(cmd, hook.blocking, hook.timeout)
            results.append(result)

            if hook.once:
                to_remove.append(hook)

        # Remove once-only hooks
        for hook in to_remove:
            try:
                self._hooks[key].remove(hook)
            except ValueError:
                pass

        return results

    @property
    def hook_count(self) -> int:
        """Total number of registered hooks across all events."""
        return sum(len(hooks) for hooks in self._hooks.values())

    # ---- internals ----

    @staticmethod
    async def _run_command(command: str, blocking: bool, timeout: int) -> HookResult:
        """Execute a shell command as a subprocess."""
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            if not blocking:
                # Fire-and-forget — return immediately
                return HookResult(success=True, output="", exit_code=0)

            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return HookResult(
                    success=False,
                    output="",
                    exit_code=-1,
                    blocking_error=f"Hook timed out after {timeout}s",
                    prevent_continuation=False,
                )

            output = (stdout or b"").decode("utf-8", errors="replace").strip()
            exit_code = proc.returncode or 0
            success = exit_code == 0

            return HookResult(
                success=success,
                output=output,
                exit_code=exit_code,
                blocking_error=None if success else f"Hook exited with code {exit_code}",
                prevent_continuation=not success,
            )

        except Exception as exc:
            return HookResult(
                success=False,
                output="",
                exit_code=-1,
                blocking_error=str(exc),
                prevent_continuation=False,
            )
