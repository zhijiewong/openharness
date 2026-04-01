"""OpenAI provider — official OpenAI API."""

from __future__ import annotations

from openharness.core.config import ProviderConfig
from openharness.core.types import ModelInfo

from .openai_compat import OpenAICompatProvider

DEFAULT_OPENAI_URL = "https://api.openai.com"

# Known model pricing: (input_cost_per_Mtok, output_cost_per_Mtok)
OPENAI_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "o3-mini": (1.10, 4.40),
}

# Known context windows
OPENAI_CONTEXT_WINDOWS: dict[str, int] = {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "o3-mini": 200_000,
}


class OpenAIProvider(OpenAICompatProvider):
    """Provider for the official OpenAI API."""

    MODEL_PRICING = OPENAI_MODEL_PRICING
    PROVIDER_NAME = "openai"
    DEFAULT_BASE_URL = DEFAULT_OPENAI_URL
    DEFAULT_MODEL = "gpt-4o-mini"

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        if not self.api_key:
            from openharness.core.exceptions import ProviderError

            raise ProviderError(
                "OpenAI provider requires an API key. "
                "Set it via config or OPENAI_API_KEY environment variable."
            )

    def list_models(self) -> list[ModelInfo]:
        """Return a curated list of OpenAI models with known pricing."""
        models: list[ModelInfo] = []
        for model_id, (input_price, output_price) in OPENAI_MODEL_PRICING.items():
            context_window = OPENAI_CONTEXT_WINDOWS.get(model_id, 128_000)
            models.append(
                ModelInfo(
                    id=model_id,
                    provider=self.PROVIDER_NAME,
                    context_window=context_window,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_vision=model_id.startswith("gpt-4o"),
                    input_cost_per_mtok=input_price,
                    output_cost_per_mtok=output_price,
                )
            )
        return models
