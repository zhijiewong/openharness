"""AgentLoop — the core LLM ↔ Tool orchestration cycle.

Mirrors Claude Code's query.ts while(true) pattern:
1. Send messages to LLM
2. If LLM requests tools → execute them → loop back
3. If LLM returns text → yield to user → done
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from uuid import uuid4

from openharness.core.events import (
    CostUpdate,
    ErrorEvent,
    Event,
    TextDelta,
    ToolCallEnd,
    ToolCallStart,
    TurnComplete,
)
from openharness.core.exceptions import BudgetExceededError, ToolNotFoundError
from openharness.core.session import Session
from openharness.core.types import Message, Role, ToolCall, ToolResult
from openharness.providers.base import BaseProvider
from openharness.tools.base import BaseTool, ToolContext
from openharness.tools.registry import ToolRegistry

from .permissions import PermissionGate

MAX_TURNS = 50


class AgentLoop:
    """The core agent harness — orchestrates LLM ↔ Tool cycles.

    Usage:
        loop = AgentLoop(provider=ollama, tools=registry, ...)
        async for event in loop.run("Fix the bug in app.py"):
            handle(event)
    """

    def __init__(
        self,
        provider: BaseProvider,
        tools: ToolRegistry,
        permission_gate: PermissionGate,
        session: Session | None = None,
        system_prompt: str = "",
        rules_prompt: str = "",
        project_context: str = "",
        memory_prompt: str = "",
        working_dir: Path | None = None,
        max_turns: int = MAX_TURNS,
        max_cost: float = 0.0,
        hooks: Any = None,
    ) -> None:
        self.provider = provider
        self.tools = tools
        self.permission_gate = permission_gate
        self.session = session or Session()
        self.system_prompt = system_prompt
        self.rules_prompt = rules_prompt
        self.project_context = project_context
        self.memory_prompt = memory_prompt
        self.working_dir = working_dir or Path.cwd()
        self.max_turns = max_turns
        self.max_cost = max_cost
        self._total_cost = 0.0
        self.hooks = hooks

    async def run(self, user_message: str) -> AsyncIterator[Event]:
        """Run the agent loop for a user message.

        Yields events as they happen (streaming text, tool calls, costs).
        """
        # Add user message to session
        self.session.add_user_message(user_message)

        # Build system message if needed
        messages = self._build_messages()
        tool_specs = self.tools.list_specs() if self.tools else []
        tool_context = ToolContext(working_dir=self.working_dir)

        turn = 0

        while turn < self.max_turns:
            turn += 1

            # Check budget
            if self.max_cost > 0 and self._total_cost >= self.max_cost:
                yield ErrorEvent(message=f"Budget exceeded: ${self._total_cost:.4f} >= ${self.max_cost:.2f}")
                yield TurnComplete(reason="budget_exceeded")
                return

            # Call the LLM
            response = await self.provider.complete(
                messages=messages,
                tools=tool_specs if tool_specs else None,
                model=None,  # Use provider default
            )

            # Add assistant response to session
            self.session.add_assistant_message(
                content=response.content,
                tool_calls=response.tool_calls,
            )

            # Yield the text content
            if response.content:
                yield TextDelta(content=response.content)

            # If no tool calls, we're done
            if not response.tool_calls:
                yield TurnComplete(reason="completed")
                return

            # Execute tool calls, yielding start/end events as they happen
            tool_results: list[ToolResult] = []
            async for event_or_result in self._execute_tools_with_events(
                response.tool_calls, tool_context
            ):
                if isinstance(event_or_result, ToolResult):
                    tool_results.append(event_or_result)
                else:
                    yield event_or_result

            # Add tool results to messages for next turn
            for tc, tr in zip(response.tool_calls, tool_results):
                self.session.add_tool_result(
                    call_id=tc.id,
                    output=tr.output,
                    is_error=tr.is_error,
                )

            # Rebuild messages with tool results for next iteration
            messages = self._build_messages()

        yield TurnComplete(reason="max_turns")

    async def _execute_tools_with_events(
        self,
        tool_calls: tuple[ToolCall, ...],
        context: ToolContext,
    ) -> AsyncIterator[Event | ToolResult]:
        """Execute tool calls, yielding ToolCallStart/End events in real time.

        Read-only tools run in parallel, write tools run serially.
        """
        batches = _partition_tool_calls(tool_calls, self.tools)

        for batch in batches:
            if batch["concurrent"]:
                # Yield all starts, then run in parallel, then yield all ends
                for tc in batch["calls"]:
                    yield ToolCallStart(tool_name=tc.tool_name, call_id=tc.id)
                tasks = [self._execute_single_tool(tc, context) for tc in batch["calls"]]
                batch_results = await asyncio.gather(*tasks)
                for tc, result in zip(batch["calls"], batch_results):
                    yield ToolCallEnd(call_id=tc.id, output=result.output, is_error=result.is_error)
                    yield result
            else:
                for tc in batch["calls"]:
                    yield ToolCallStart(tool_name=tc.tool_name, call_id=tc.id)
                    result = await self._execute_single_tool(tc, context)
                    yield ToolCallEnd(call_id=tc.id, output=result.output, is_error=result.is_error)
                    yield result

    async def _execute_single_tool(
        self, tool_call: ToolCall, context: ToolContext
    ) -> ToolResult:
        """Execute a single tool call with permission checking."""
        # Find the tool
        try:
            tool = self.tools.get(tool_call.tool_name)
        except ToolNotFoundError:
            return ToolResult(
                call_id=tool_call.id,
                output=f"Error: Unknown tool '{tool_call.tool_name}'",
                is_error=True,
            )

        # Validate input
        error = await tool.validate_input(tool_call.arguments, context)
        if error:
            return ToolResult(call_id=tool_call.id, output=f"Validation error: {error}", is_error=True)

        # Check permissions
        perm = await self.permission_gate.check(tool, tool_call.arguments, context)
        if not perm.allowed:
            return ToolResult(
                call_id=tool_call.id,
                output=f"Permission denied: {perm.reason}",
                is_error=True,
            )

        # Trigger pre-tool hooks
        if self.hooks:
            try:
                from openharness.harness.hooks import HookEvent
                await self.hooks.trigger(HookEvent.PRE_TOOL_USE, {
                    "tool_name": tool_call.tool_name,
                    "tool_input": tool_call.arguments,
                })
            except Exception:
                pass  # Don't block on hook failures

        # Execute
        try:
            result = await tool.execute(tool_call.arguments, context)
            final = ToolResult(call_id=tool_call.id, output=result.output, is_error=result.is_error)
        except Exception as exc:
            final = ToolResult(call_id=tool_call.id, output=f"Tool error: {exc}", is_error=True)

        # Trigger post-tool hooks
        if self.hooks:
            try:
                from openharness.harness.hooks import HookEvent
                event = HookEvent.POST_TOOL_USE if not final.is_error else HookEvent.ON_ERROR
                await self.hooks.trigger(event, {
                    "tool_name": tool_call.tool_name,
                    "tool_input": tool_call.arguments,
                    "output": final.output[:500],
                    "is_error": final.is_error,
                })
            except Exception:
                pass

        return final

    def _build_messages(self) -> list[Message]:
        """Build the message list for the LLM (system + rules + context + history)."""
        messages: list[Message] = []

        # Build full system prompt: base + project context + rules + memory
        system_parts: list[str] = []
        if self.system_prompt:
            system_parts.append(self.system_prompt)
        if self.project_context:
            system_parts.append(self.project_context)
        if self.rules_prompt:
            system_parts.append(self.rules_prompt)
        if self.memory_prompt:
            system_parts.append(self.memory_prompt)

        if system_parts:
            messages.append(Message(role=Role.SYSTEM, content="\n\n".join(system_parts)))

        # Conversation history
        messages.extend(m for m in self.session.messages if not m.is_meta)

        return messages


def _partition_tool_calls(
    tool_calls: tuple[ToolCall, ...],
    registry: ToolRegistry,
) -> list[dict[str, Any]]:
    """Partition tool calls into concurrent and serial batches.

    Consecutive read-only tools are grouped for parallel execution.
    Write tools get their own serial batch.
    """
    batches: list[dict[str, Any]] = []
    current_concurrent: list[ToolCall] = []

    for tc in tool_calls:
        try:
            tool = registry.get(tc.tool_name)
            is_safe = tool.is_concurrency_safe(tc.arguments)
        except ToolNotFoundError:
            is_safe = False

        if is_safe:
            current_concurrent.append(tc)
        else:
            # Flush any pending concurrent batch
            if current_concurrent:
                batches.append({"concurrent": True, "calls": current_concurrent})
                current_concurrent = []
            # Serial batch for this tool
            batches.append({"concurrent": False, "calls": [tc]})

    # Flush remaining concurrent
    if current_concurrent:
        batches.append({"concurrent": True, "calls": current_concurrent})

    return batches
