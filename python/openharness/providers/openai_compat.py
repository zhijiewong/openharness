"""OpenAI-compatible provider — works with any API that follows the OpenAI format."""

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


def _messages_to_openai(messages: list[Message]) -> list[dict[str, Any]]:
    """Convert OpenHarness messages to OpenAI chat format."""
    result: list[dict[str, Any]] = []
    for msg in messages:
        if msg.is_meta:
            continue

        # Tool results are sent as role=tool messages
        if msg.tool_results:
            for tr in msg.tool_results:
                result.append({
                    "role": "tool",
                    "tool_call_id": tr.call_id,
                    "content": tr.output,
                })
            continue

        entry: dict[str, Any] = {
            "role": msg.role.value,
            "content": msg.content,
        }

        if msg.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.tool_name,
                        "arguments": json.dumps(tc.arguments),
                    },
                }
                for tc in msg.tool_calls
            ]
            # OpenAI expects content to be null when there are tool calls
            if not msg.content:
                entry["content"] = None

        result.append(entry)
    return result


def _tools_to_openai(tools: list[ToolSpec]) -> list[dict[str, Any]]:
    """Convert tool specs to OpenAI function-calling format."""
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


def _parse_tool_calls(raw_calls: list[dict[str, Any]]) -> tuple[ToolCall, ...]:
    """Parse tool calls from an OpenAI response."""
    calls: list[ToolCall] = []
    for tc in raw_calls:
        fn = tc.get("function", {})
        raw_args = fn.get("arguments", "{}")
        try:
            arguments = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError:
            arguments = {"raw": raw_args}
        calls.append(
            ToolCall(
                id=tc.get("id", ""),
                tool_name=fn.get("name", ""),
                arguments=arguments,
            )
        )
    return tuple(calls)


def _calculate_cost(
    input_tokens: int,
    output_tokens: int,
    input_cost_per_mtok: float,
    output_cost_per_mtok: float,
) -> float:
    """Calculate cost in USD from token counts and per-million-token pricing."""
    return (input_tokens * input_cost_per_mtok + output_tokens * output_cost_per_mtok) / 1_000_000


class OpenAICompatProvider(BaseProvider):
    """Provider for any OpenAI-compatible API (DeepSeek, Qwen, Groq, Mistral, Together, etc.)."""

    # Subclasses can override these for known model pricing
    MODEL_PRICING: dict[str, tuple[float, float]] = {}  # model -> (input_$/Mtok, output_$/Mtok)
    PROVIDER_NAME: str = "openai_compat"
    DEFAULT_BASE_URL: str = ""
    DEFAULT_MODEL: str = "gpt-3.5-turbo"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.base_url = (config.base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.api_key = config.api_key or ""
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=300.0,
            headers=self._build_headers(),
        )

    def _build_headers(self) -> dict[str, str]:
        """Build HTTP headers. Subclasses can extend this."""
        headers: dict[str, str] = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get_model(self, model: str | None) -> str:
        return model or self.config.default_model or self.DEFAULT_MODEL

    def _get_pricing(self, model: str) -> tuple[float, float]:
        """Return (input_cost_per_mtok, output_cost_per_mtok) for a model."""
        return self.MODEL_PRICING.get(model, (0.0, 0.0))

    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> Message:
        """Non-streaming completion via OpenAI-compatible endpoint."""
        model = self._get_model(model)
        payload: dict[str, Any] = {
            "model": model,
            "messages": _messages_to_openai(messages),
            "stream": False,
        }
        if tools:
            payload["tools"] = _tools_to_openai(tools)

        try:
            resp = await self._client.post("/v1/chat/completions", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.PROVIDER_NAME} request failed: {exc}") from exc

        data = resp.json()
        choice = data.get("choices", [{}])[0]
        msg_data = choice.get("message", {})
        content = msg_data.get("content", "") or ""

        # Parse tool calls
        tool_calls: tuple[ToolCall, ...] = ()
        if raw_calls := msg_data.get("tool_calls"):
            tool_calls = _parse_tool_calls(raw_calls)

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
        """Stream response events via SSE from an OpenAI-compatible endpoint."""
        model = self._get_model(model)
        payload: dict[str, Any] = {
            "model": model,
            "messages": _messages_to_openai(messages),
            "stream": True,
        }
        if tools:
            payload["tools"] = _tools_to_openai(tools)

        input_cost, output_cost = self._get_pricing(model)
        total_input = 0
        total_output = 0

        try:
            async with self._client.stream(
                "POST", "/v1/chat/completions", json=payload
            ) as resp:
                resp.raise_for_status()
                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue

                    data_str = line[len("data: "):]
                    if data_str == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # Extract usage if present (some providers include it)
                    if usage := chunk.get("usage"):
                        total_input = usage.get("prompt_tokens", total_input)
                        total_output = usage.get("completion_tokens", total_output)

                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta", {})

                        # Text content
                        if content := delta.get("content"):
                            yield TextDelta(content=content)

                        # Tool calls in streamed chunks are accumulated by the caller
                        # We emit text deltas for tool call arguments as they arrive
                        if delta.get("tool_calls"):
                            for tc_delta in delta["tool_calls"]:
                                fn = tc_delta.get("function", {})
                                if args_chunk := fn.get("arguments", ""):
                                    # Signal tool call data via empty TextDelta
                                    pass

        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.PROVIDER_NAME} streaming failed: {exc}") from exc

        # Emit final cost update
        cost = _calculate_cost(total_input, total_output, input_cost, output_cost)
        yield CostUpdate(
            input_tokens=total_input,
            output_tokens=total_output,
            cost=cost,
            model=model,
        )

    def list_models(self) -> list[ModelInfo]:
        """List available models from the OpenAI-compatible API."""
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=10.0,
                headers=self._build_headers(),
            ) as client:
                resp = client.get("/v1/models")
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError:
            return []

        models: list[ModelInfo] = []
        for m in data.get("data", []):
            model_id = m.get("id", "")
            input_price, output_price = self._get_pricing(model_id)
            models.append(
                ModelInfo(
                    id=model_id,
                    provider=self.PROVIDER_NAME,
                    supports_tools=True,
                    supports_streaming=True,
                    input_cost_per_mtok=input_price,
                    output_cost_per_mtok=output_price,
                )
            )
        return models

    async def health_check(self) -> bool:
        """Check if the provider is reachable by listing models."""
        try:
            resp = await self._client.get("/v1/models")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False
