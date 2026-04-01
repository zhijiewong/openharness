"""OpenRouter provider — access many models through a single OpenAI-compatible API."""

from __future__ import annotations

from typing import Any

import httpx

from openharness.core.config import ProviderConfig
from openharness.core.types import ModelInfo

from .openai_compat import OpenAICompatProvider

DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api"


class OpenRouterProvider(OpenAICompatProvider):
    """Provider for OpenRouter, a unified gateway to many LLM providers."""

    PROVIDER_NAME = "openrouter"
    DEFAULT_BASE_URL = DEFAULT_OPENROUTER_URL
    DEFAULT_MODEL = "openai/gpt-4o-mini"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        if not self.api_key:
            from openharness.core.exceptions import ProviderError

            raise ProviderError(
                "OpenRouter provider requires an API key. "
                "Set it via config or OPENROUTER_API_KEY environment variable."
            )
        self._referer = config.extra.get("http_referer", "https://github.com/openharness")
        self._title = config.extra.get("x_title", "OpenHarness")

    def _build_headers(self) -> dict[str, str]:
        """Build headers with OpenRouter-specific fields."""
        headers = super()._build_headers()
        headers["HTTP-Referer"] = self._referer
        headers["X-Title"] = self._title
        return headers

    def list_models(self) -> list[ModelInfo]:
        """List available models from OpenRouter's model catalogue."""
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
            pricing: dict[str, Any] = m.get("pricing", {})

            # OpenRouter returns pricing as strings in dollars per token
            try:
                input_price = float(pricing.get("prompt", "0")) * 1_000_000
            except (ValueError, TypeError):
                input_price = 0.0
            try:
                output_price = float(pricing.get("completion", "0")) * 1_000_000
            except (ValueError, TypeError):
                output_price = 0.0

            context_window = int(m.get("context_length", 8192))

            models.append(
                ModelInfo(
                    id=model_id,
                    provider=self.PROVIDER_NAME,
                    context_window=context_window,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_vision="vision" in model_id.lower() or "4o" in model_id,
                    input_cost_per_mtok=input_price,
                    output_cost_per_mtok=output_price,
                )
            )
        return models
