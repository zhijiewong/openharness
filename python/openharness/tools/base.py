"""Abstract base class for tools — mirrors Claude Code's Tool interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openharness.core.types import PermissionResult, RiskLevel, ToolResult, ToolSpec


@dataclass
class ToolContext:
    """Context passed to tools during execution."""

    working_dir: Path
    # Extended in later phases with session, config, cost_tracker


class BaseTool(ABC):
    """Every tool implements this interface.

    Mirrors the Claude Code Tool type:
    - name, description, parameters_schema
    - risk_level for permission gating
    - is_read_only / is_concurrency_safe for parallel execution
    - check_permissions / execute
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique tool name."""

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description (also sent to LLM)."""

    @property
    @abstractmethod
    def parameters_schema(self) -> dict[str, Any]:
        """JSON Schema for tool input validation."""

    @property
    def risk_level(self) -> RiskLevel:
        """Risk classification for permission gating."""
        return RiskLevel.LOW

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        """Whether this invocation only reads (no side effects)."""
        return True

    def is_concurrency_safe(self, arguments: dict[str, Any]) -> bool:
        """Whether this tool can run in parallel with other tools.

        Read-only tools are generally concurrency safe.
        """
        return self.is_read_only(arguments)

    async def check_permissions(
        self, arguments: dict[str, Any], context: ToolContext
    ) -> PermissionResult:
        """Check whether this tool call should be allowed.

        Default: auto-approve read-only LOW risk, ask for everything else.
        """
        if self.risk_level == RiskLevel.LOW and self.is_read_only(arguments):
            return PermissionResult(allowed=True, reason="auto-approved", risk_level=self.risk_level)
        # Higher risk tools return "needs approval" — the permission gate decides
        return PermissionResult(allowed=False, reason="needs-approval", risk_level=self.risk_level)

    async def validate_input(self, arguments: dict[str, Any], context: ToolContext) -> str | None:
        """Validate input before execution. Returns error message or None."""
        return None

    @abstractmethod
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        """Execute the tool and return a result."""

    def to_spec(self) -> ToolSpec:
        """Convert to ToolSpec for sending to the LLM."""
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters=self.parameters_schema,
            risk_level=self.risk_level,
        )
