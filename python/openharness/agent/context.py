"""ContextManager — token estimation and message compression.

Mirrors Claude Code's context-window management: estimate what fits,
snip old tool results, and truncate history when needed.
"""

from __future__ import annotations

from copy import deepcopy

from openharness.core.types import Message, Role, ToolSpec

# Simple token estimation: ~4 chars per token (rough but fast)
CHARS_PER_TOKEN = 4


class ContextManager:
    """Manage what fits in the LLM's context window."""

    def __init__(self, max_tokens: int = 128_000) -> None:
        self.max_tokens = max_tokens

    def estimate_tokens(self, text: str) -> int:
        """Rough token count estimation."""
        return len(text) // CHARS_PER_TOKEN

    def estimate_messages_tokens(self, messages: list[Message]) -> int:
        """Estimate total tokens for a message list."""
        total = 0
        for msg in messages:
            total += self.estimate_tokens(msg.content)
            # Tool calls and results add overhead
            for tc in msg.tool_calls:
                total += self.estimate_tokens(str(tc.arguments)) + 10
            for tr in msg.tool_results:
                total += self.estimate_tokens(tr.output) + 5
        return total

    def fits_in_context(self, messages: list[Message], buffer: int = 4000) -> bool:
        """Check if messages fit within context window with buffer."""
        return self.estimate_messages_tokens(messages) <= (self.max_tokens - buffer)

    def compress_messages(
        self,
        messages: list[Message],
        target_tokens: int | None = None,
    ) -> list[Message]:
        """Compress message history to fit in context.

        Strategy (simplified 2-stage, mirrors Claude Code):
        1. Snip: Remove old tool results (replace with "[tool result truncated]")
        2. Truncate: Drop oldest messages if still too large

        Always preserves: system message, last N user/assistant messages.
        """
        target = target_tokens or (self.max_tokens - 4000)
        result = deepcopy(messages)

        # Stage 1: snip old tool results
        result = self._snip_tool_results(result, keep_recent=5)

        if self.estimate_messages_tokens(result) <= target:
            return result

        # Stage 2: drop oldest non-system messages, keeping the last 6
        keep_tail = 6
        system_msgs = [m for m in result if m.role == Role.SYSTEM]
        non_system = [m for m in result if m.role != Role.SYSTEM]

        if len(non_system) > keep_tail:
            non_system = non_system[-keep_tail:]

        result = system_msgs + non_system

        return result

    def _snip_tool_results(
        self,
        messages: list[Message],
        keep_recent: int = 5,
    ) -> list[Message]:
        """Replace old tool results with truncated summaries.

        Keeps the most recent *keep_recent* tool-result messages intact.
        """
        # Find indices of messages that carry tool results
        tool_result_indices = [
            i for i, m in enumerate(messages) if m.tool_results
        ]

        if len(tool_result_indices) <= keep_recent:
            return messages

        # Indices to snip (everything except the last keep_recent)
        snip_set = set(tool_result_indices[:-keep_recent])
        result: list[Message] = []

        for i, msg in enumerate(messages):
            if i in snip_set:
                # Replace with a lightweight placeholder
                from openharness.core.types import ToolResult as TR

                snipped_results = tuple(
                    TR(call_id=tr.call_id, output="[tool result truncated]", is_error=tr.is_error)
                    for tr in msg.tool_results
                )
                result.append(Message(
                    role=msg.role,
                    content=msg.content,
                    tool_calls=msg.tool_calls,
                    tool_results=snipped_results,
                    timestamp=msg.timestamp,
                    uuid=msg.uuid,
                    is_meta=msg.is_meta,
                ))
            else:
                result.append(msg)

        return result

    def build_context(
        self,
        messages: list[Message],
        system_parts: list[str],
        tools: list[ToolSpec],
    ) -> list[Message]:
        """Build final message list that fits in context window.

        Assembles system prompt, estimates tool-spec overhead, then
        compresses conversation history to fit.
        """
        # Estimate overhead from system prompt and tool specs
        system_text = "\n\n".join(system_parts) if system_parts else ""
        tool_overhead = sum(
            self.estimate_tokens(t.description) + self.estimate_tokens(str(t.parameters)) + 20
            for t in tools
        )
        system_tokens = self.estimate_tokens(system_text) + tool_overhead

        # Available tokens for conversation messages
        available = self.max_tokens - system_tokens - 4000  # reserve buffer

        # Build system message
        result: list[Message] = []
        if system_text:
            result.append(Message(role=Role.SYSTEM, content=system_text))

        # Compress conversation to fit
        conversation = [m for m in messages if m.role != Role.SYSTEM]
        conversation = self.compress_messages(conversation, target_tokens=available)
        result.extend(conversation)

        return result
