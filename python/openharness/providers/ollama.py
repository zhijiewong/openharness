"""Ollama provider — local LLM inference via Ollama API."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from openharness.core.config import ProviderConfig
from openharness.core.events import CostUpdate, Event, TextDelta, ToolCallStart, TurnComplete
from openharness.core.exceptions import ProviderError
from openharness.core.types import (
    Message,
    ModelInfo,
    Role,
    ToolCall,
    ToolSpec,
)

from .base import BaseProvider

DEFAULT_OLLAMA_URL = "http://localhost:11434"


def _messages_to_ollama(messages: list[Message]) -> list[dict[str, Any]]:
    """Convert OpenHarness messages to Ollama chat format."""
    result: list[dict[str, Any]] = []
    for msg in messages:
        if msg.is_meta:
            continue
        entry: dict[str, Any] = {
            "role": msg.role.value if msg.role != Role.TOOL else "tool",
            "content": msg.content,
        }
        if msg.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.tool_name, "arguments": tc.arguments},
                }
                for tc in msg.tool_calls
            ]
        if msg.tool_results:
            # Ollama expects tool results as content in a "tool" role message
            entry["content"] = msg.tool_results[0].output if msg.tool_results else msg.content
        result.append(entry)
    return result


def _tools_to_ollama(tools: list[ToolSpec]) -> list[dict[str, Any]]:
    """Convert tool specs to Ollama tool format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in tools
    ]


class OllamaProvider(BaseProvider):
    """Provider for Ollama local models."""

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.base_url = config.base_url or DEFAULT_OLLAMA_URL
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=300.0)

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> Message:
        """Non-streaming completion."""
        model = model or self.config.default_model or "llama3"
        payload: dict[str, Any] = {
            "model": model,
            "messages": _messages_to_ollama(messages),
            "stream": False,
        }
        if tools:
            payload["tools"] = _tools_to_ollama(tools)

        try:
            resp = await self._client.post("/api/chat", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError(f"Ollama request failed: {exc}") from exc

        data = resp.json()
        msg_data = data.get("message", {})
        content = msg_data.get("content", "")

        # Parse tool calls if present
        tool_calls: tuple[ToolCall, ...] = ()
        if raw_calls := msg_data.get("tool_calls"):
            tool_calls = tuple(
                ToolCall(
                    id=tc.get("id", f"call_{i}"),
                    tool_name=tc["function"]["name"],
                    arguments=tc["function"].get("arguments", {}),
                )
                for i, tc in enumerate(raw_calls)
            )

        return Message(
            role=Role.ASSISTANT,
            content=content,
            tool_calls=tool_calls,
        )

    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[Event]:
        """Stream response events from Ollama."""
        model = model or self.config.default_model or "llama3"
        payload: dict[str, Any] = {
            "model": model,
            "messages": _messages_to_ollama(messages),
            "stream": True,
        }
        if tools:
            payload["tools"] = _tools_to_ollama(tools)

        total_input = 0
        total_output = 0

        try:
            async with self._client.stream("POST", "/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # Text content
                    msg = chunk.get("message", {})
                    if content := msg.get("content", ""):
                        yield TextDelta(content=content)

                    # Tool calls in streamed response
                    if raw_calls := msg.get("tool_calls"):
                        for i, tc in enumerate(raw_calls):
                            fn = tc.get("function", {})
                            yield ToolCallStart(
                                tool_name=fn.get("name", f"unknown_{i}"),
                                call_id=tc.get("id", f"call_{i}"),
                            )

                    # Done flag
                    if chunk.get("done"):
                        total_input = chunk.get("prompt_eval_count", 0)
                        total_output = chunk.get("eval_count", 0)
                        yield CostUpdate(
                            input_tokens=total_input,
                            output_tokens=total_output,
                            cost=0.0,  # Local models are free
                            model=model,
                        )

        except httpx.HTTPError as exc:
            raise ProviderError(f"Ollama streaming failed: {exc}") from exc

    def list_models(self) -> list[ModelInfo]:
        """List locally available Ollama models (synchronous for simplicity)."""
        try:
            with httpx.Client(base_url=self.base_url, timeout=10.0) as client:
                resp = client.get("/api/tags")
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError:
            return []

        models: list[ModelInfo] = []
        for m in data.get("models", []):
            name = m.get("name", "")
            details = m.get("details", {})
            models.append(
                ModelInfo(
                    id=name,
                    provider="ollama",
                    context_window=int(details.get("context_length", 8192)),
                    supports_tools=True,
                    supports_streaming=True,
                    supports_vision="vision" in name.lower(),
                    input_cost_per_mtok=0.0,
                    output_cost_per_mtok=0.0,
                )
            )
        return models

    async def health_check(self) -> bool:
        """Check if Ollama is running locally."""
        try:
            resp = await self._client.get("/api/tags")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False

    @staticmethod
    def auto_detect() -> bool:
        """Check if Ollama is running at the default URL."""
        try:
            resp = httpx.get(f"{DEFAULT_OLLAMA_URL}/api/tags", timeout=3.0)
            return resp.status_code == 200
        except httpx.HTTPError:
            return False
