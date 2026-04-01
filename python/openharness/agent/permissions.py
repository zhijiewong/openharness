"""Permission gate — controls which tool calls are allowed.

Inspired by Claude Code's ToolPermissionContext with modes:
- "ask": prompt user for non-trivial tools
- "trust": allow everything
- "deny": block everything except read-only LOW risk
"""

from __future__ import annotations

from typing import Any, Callable, Coroutine

from openharness.core.types import PermissionResult, RiskLevel
from openharness.tools.base import BaseTool, ToolContext


# Type for the user-prompt callback
AskUserFn = Callable[[str, str, dict[str, Any]], Coroutine[Any, Any, bool]]


class PermissionGate:
    """Decides whether a tool call is allowed to execute."""

    def __init__(
        self,
        mode: str = "ask",
        ask_user: AskUserFn | None = None,
    ) -> None:
        self.mode = mode
        self._ask_user = ask_user

    async def check(
        self,
        tool: BaseTool,
        arguments: dict[str, Any],
        context: ToolContext,
    ) -> PermissionResult:
        """Check if a tool call should be allowed.

        Decision matrix (mirrors Claude Code):
        - LOW risk + read-only: always allow
        - trust mode: always allow
        - deny mode: only allow LOW read-only
        - ask mode:
          - LOW risk: allow
          - MEDIUM risk: ask user
          - HIGH risk: ask user
        """
        risk = tool.risk_level
        read_only = tool.is_read_only(arguments)

        # Always allow read-only LOW risk
        if risk == RiskLevel.LOW and read_only:
            return PermissionResult(allowed=True, reason="auto-approved", risk_level=risk)

        # Trust mode: allow everything
        if self.mode == "trust":
            return PermissionResult(allowed=True, reason="trust-mode", risk_level=risk)

        # Deny mode: block everything except the above
        if self.mode == "deny":
            return PermissionResult(allowed=False, reason="deny-mode", risk_level=risk)

        # Ask mode: prompt the user for MEDIUM/HIGH risk
        if self.mode == "ask" and self._ask_user is not None:
            description = f"{tool.name}: {_summarize_args(tool.name, arguments)}"
            allowed = await self._ask_user(tool.name, description, arguments)
            reason = "user-approved" if allowed else "user-denied"
            return PermissionResult(allowed=allowed, reason=reason, risk_level=risk)

        # No ask callback available — auto-approve LOW, deny others
        if risk == RiskLevel.LOW:
            return PermissionResult(allowed=True, reason="auto-approved-low", risk_level=risk)

        return PermissionResult(allowed=False, reason="no-approval-callback", risk_level=risk)


def _summarize_args(tool_name: str, args: dict[str, Any]) -> str:
    """Create a short summary of tool arguments for the permission prompt."""
    if tool_name == "Bash":
        return args.get("command", "")[:200]
    if tool_name in ("Read", "Write", "Edit"):
        return args.get("file_path", "")
    # Generic: show first key=value pairs
    parts = [f"{k}={str(v)[:80]}" for k, v in list(args.items())[:3]]
    return ", ".join(parts)
