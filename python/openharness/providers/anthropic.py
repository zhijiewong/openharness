"""Anthropic provider — Claude models via the Anthropic Messages API."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from openharness.core.config import ProviderConfig
from openharness.core.events import CostUpdate, Event, TextDelta, TurnComplete
from openharness.core.exceptions import ProviderError
from openharness.core.types import (
    Message,
    ModelInfo,
    Role,
    ToolCall,
    ToolSpec,
)

from .base import BaseProvider

DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 4096

# Known model pricing: (input_cost_per_Mtok, output_cost_per_Mtok)
ANTHROPIC_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (0.80, 4.00),
    "claude-opus-4-6": (15.00, 75.00),
}

# Known context windows
ANTHROPIC_CONTEXT_WINDOWS: dict[str, int] = {
    "claude-sonnet-4-6": 200_000,
    "claude-haiku-4-5": 200_000,
    "claude-opus-4-6": 200_000,
}


def _messages_to_anthropic(
    messages: list[Message],
) -> tuple[str, list[dict[str, Any]]]:
    """Convert OpenHarness messages to Anthropic format.

    Returns (system_prompt, messages_list).
    System messages are extracted into a separate system string.
    """
    system_parts: list[str] = []
    result: list[dict[str, Any]] = []

    for msg in messages:
        if msg.is_meta:
            continue

        # System messages go into the system field
        if msg.role == Role.SYSTEM:
            system_parts.append(msg.content)
            continue

        # Tool results are sent as user messages with tool_result content blocks
        if msg.tool_results:
            content_blocks: list[dict[str, Any]] = []
            for tr in msg.tool_results:
                block: dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": tr.call_id,
                    "content": tr.output,
                }
                if tr.is_error:
                    block["is_error"] = True
                content_blocks.append(block)
            result.append({"role": "user", "content": content_blocks})
            continue

        # Assistant messages with tool calls become content blocks
        if msg.role == Role.ASSISTANT and msg.tool_calls:
            content_blocks = []
            if msg.content:
                content_blocks.append({"type": "text", "text": msg.content})
            for tc in msg.tool_calls:
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.tool_name,
                    "input": tc.arguments,
                })
            result.append({"role": "assistant", "content": content_blocks})
            continue

        # Regular user/assistant messages
        result.append({
            "role": msg.role.value,
            "content": msg.content,
        })

    system = "\n\n".join(system_parts)
    return system, result


def _tools_to_anthropic(tools: list[ToolSpec]) -> list[dict[str, Any]]:
    """Convert tool specs to Anthropic tool format."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters,
        }
        for t in tools
    ]


def _parse_content_blocks(content: list[dict[str, Any]]) -> tuple[str, tuple[ToolCall, ...]]:
    """Parse Anthropic response content blocks into text and tool calls."""
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []

    for block in content:
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
        elif block.get("type") == "tool_use":
            tool_calls.append(
                ToolCall(
                    id=block.get("id", ""),
                    tool_name=block.get("name", ""),
                    arguments=block.get("input", {}),
                )
            )

    return "\n".join(text_parts), tuple(tool_calls)


def _calculate_cost(
    input_tokens: int,
    output_tokens: int,
    input_cost_per_mtok: float,
    output_cost_per_mtok: float,
) -> float:
    """Calculate cost in USD from token counts and per-million-token pricing."""
    return (input_tokens * input_cost_per_mtok + output_tokens * output_cost_per_mtok) / 1_000_000


class AnthropicProvider(BaseProvider):
    """Provider for Anthropic Claude models."""

    PROVIDER_NAME = "anthropic"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.base_url = (config.base_url or DEFAULT_ANTHROPIC_URL).rstrip("/")
        self.api_key = config.api_key or ""
        self.default_model = config.default_model or "claude-sonnet-4-6"
        self.max_tokens = int(config.extra.get("max_tokens", DEFAULT_MAX_TOKENS))
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=300.0,
            headers=self._build_headers(),
        )

    def _build_headers(self) -> dict[str, str]:
        """Build Anthropic-specific HTTP headers."""
        headers: dict[str, str] = {
            "content-type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers

    def _get_model(self, model: str | None) -> str:
        return model or self.default_model

    def _get_pricing(self, model: str) -> tuple[float, float]:
        """Return (input_cost_per_mtok, output_cost_per_mtok) for a model."""
        return ANTHROPIC_MODEL_PRICING.get(model, (0.0, 0.0))

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> Message:
        """Non-streaming completion via Anthropic Messages API."""
        model = self._get_model(model)
        system, api_messages = _messages_to_anthropic(messages)

        payload: dict[str, Any] = {
            "model": model,
            "messages": api_messages,
            "max_tokens": self.max_tokens,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = _tools_to_anthropic(tools)

        try:
            resp = await self._client.post("/v1/messages", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError(f"Anthropic request failed: {exc}") from exc

        data = resp.json()
        content_blocks = data.get("content", [])
        content, tool_calls = _parse_content_blocks(content_blocks)

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
        """Stream response events via SSE from Anthropic Messages API."""
        model = self._get_model(model)
        system, api_messages = _messages_to_anthropic(messages)

        payload: dict[str, Any] = {
            "model": model,
            "messages": api_messages,
            "max_tokens": self.max_tokens,
            "stream": True,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = _tools_to_anthropic(tools)

        input_price, output_price = self._get_pricing(model)
        total_input = 0
        total_output = 0

        try:
            async with self._client.stream(
                "POST", "/v1/messages", json=payload
            ) as resp:
                resp.raise_for_status()
                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue

                    data_str = line[len("data: "):]
                    try:
                        event_data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    event_type = event_data.get("type", "")

                    # message_start: contains usage info
                    if event_type == "message_start":
                        msg_info = event_data.get("message", {})
                        usage = msg_info.get("usage", {})
                        total_input = usage.get("input_tokens", 0)

                    # content_block_delta: text or tool input chunks
                    elif event_type == "content_block_delta":
                        delta = event_data.get("delta", {})
                        delta_type = delta.get("type", "")

                        if delta_type == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                yield TextDelta(content=text)
                        elif delta_type == "input_json_delta":
                            # Tool input JSON arriving in chunks
                            pass

                    # message_delta: final usage info
                    elif event_type == "message_delta":
                        usage = event_data.get("usage", {})
                        total_output = usage.get("output_tokens", 0)

                    # message_stop: stream is done
                    elif event_type == "message_stop":
                        break

        except httpx.HTTPError as exc:
            raise ProviderError(f"Anthropic streaming failed: {exc}") from exc

        # Emit final cost update
        cost = _calculate_cost(total_input, total_output, input_price, output_price)
        yield CostUpdate(
            input_tokens=total_input,
            output_tokens=total_output,
            cost=cost,
            model=model,
        )

    def list_models(self) -> list[ModelInfo]:
        """Return a curated list of Anthropic Claude models with known pricing."""
        models: list[ModelInfo] = []
        for model_id, (input_price, output_price) in ANTHROPIC_MODEL_PRICING.items():
            context_window = ANTHROPIC_CONTEXT_WINDOWS.get(model_id, 200_000)
            models.append(
                ModelInfo(
                    id=model_id,
                    provider=self.PROVIDER_NAME,
                    context_window=context_window,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_vision=True,
                    input_cost_per_mtok=input_price,
                    output_cost_per_mtok=output_price,
                )
            )
        return models

    async def health_check(self) -> bool:
        """Check if the Anthropic API is reachable."""
        if not self.api_key:
            return False
        try:
            # Use a minimal request to verify connectivity
            resp = await self._client.post(
                "/v1/messages",
                json={
                    "model": self.default_model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                },
            )
            # 200 = success, 401 = bad key but API is reachable
            return resp.status_code in (200, 401)
        except httpx.HTTPError:
            return False
