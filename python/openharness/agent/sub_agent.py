"""SubAgent — isolated agent for delegated parallel tasks.

Mirrors Claude Code's coordinator pattern: spawn a child agent with its own
session, run a task in isolation, and roll up costs into a single result.
"""

from __future__ import annotations

from dataclasses import dataclass

from openharness.core.events import TextDelta, ToolCallEnd
from openharness.core.session import Session

from .loop import AgentLoop


@dataclass(frozen=True)
class SubAgentResult:
    """Rolled-up result from a sub-agent execution."""

    output: str
    cost: float
    input_tokens: int
    output_tokens: int
    success: bool
    error: str | None = None


class SubAgent:
    """Isolated agent for delegated tasks. Own session, rolled-up costs.

    Usage:
        sub = SubAgent(parent_loop, "Summarize the test failures")
        result = await sub.run()
    """

    def __init__(
        self,
        parent_loop: AgentLoop,
        task: str,
        tools: list[str] | None = None,
    ) -> None:
        self._parent = parent_loop
        self._task = task
        self._allowed_tools = tools

    async def run(self) -> SubAgentResult:
        """Execute the task in isolation and return the rolled-up result."""
        # Build a filtered tool registry if specific tools were requested
        tool_registry = self._parent.tools
        if self._allowed_tools is not None and tool_registry is not None:
            from openharness.tools.registry import ToolRegistry
            filtered = ToolRegistry()
            for name in self._allowed_tools:
                if name in tool_registry:
                    filtered.register(tool_registry.get(name))
            tool_registry = filtered

        # Create child loop with a fresh session for isolation
        child = AgentLoop(
            provider=self._parent.provider,
            tools=tool_registry,
            permission_gate=self._parent.permission_gate,
            session=Session(),
            system_prompt=self._parent.system_prompt,
            working_dir=self._parent.working_dir,
            max_turns=self._parent.max_turns,
            max_cost=self._parent.max_cost,
            hooks=self._parent.hooks,
        )

        # Collect output from the child agent
        output_parts: list[str] = []
        error: str | None = None
        success = True

        try:
            async for event in child.run(self._task):
                if isinstance(event, TextDelta):
                    output_parts.append(event.content)
                elif isinstance(event, ToolCallEnd) and event.is_error:
                    # Record tool errors but don't abort — the agent may recover
                    pass
        except Exception as exc:
            success = False
            error = str(exc)

        return SubAgentResult(
            output="".join(output_parts),
            cost=child._total_cost,
            input_tokens=0,  # TODO: wire up once provider exposes token counts
            output_tokens=0,
            success=success,
            error=error,
        )
