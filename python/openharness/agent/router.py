"""ModelRouter — smart model selection based on strategy.

Routes requests to the best available model across all registered providers,
using cost and capability information from MODEL_PRICING and ModelInfo.
"""

from __future__ import annotations

from openharness.core.types import ModelInfo
from openharness.harness.cost import MODEL_PRICING
from openharness.providers.registry import ProviderRegistry


class ModelRouter:
    """Route requests to the best model based on strategy.

    Strategies:
    - "cheapest": lowest cost model that supports tools
    - "best": highest capability (most expensive)
    - "local-first": try Ollama, fall back to cloud
    - "balanced": reasonable cost-quality tradeoff
    - "fast": smallest/fastest model
    """

    def __init__(self, providers: ProviderRegistry) -> None:
        self._providers = providers

    def route(self, strategy: str = "balanced") -> tuple[str, str]:
        """Select (provider_name, model_name) based on strategy.

        Raises ValueError if no suitable model is found.
        """
        models = self._get_available_models()
        if not models:
            raise ValueError("No models available from any registered provider")

        if strategy == "cheapest":
            return self._cheapest(models)
        if strategy == "best":
            return self._best(models)
        if strategy == "local-first":
            return self._local_first(models)
        if strategy == "fast":
            return self._fast(models)
        # Default: balanced
        return self._balanced(models)

    def _get_available_models(self) -> list[tuple[str, ModelInfo]]:
        """Get all models from all providers as (provider_name, ModelInfo) pairs."""
        results: list[tuple[str, ModelInfo]] = []
        for name in self._providers.available:
            try:
                provider = self._providers.get(name)
            except Exception:
                continue
            for model_info in provider.list_models():
                results.append((name, model_info))
        return results

    # ---- strategies ----

    def _cheapest(self, models: list[tuple[str, ModelInfo]]) -> tuple[str, str]:
        """Lowest cost model that supports tools."""
        tool_models = [(n, m) for n, m in models if m.supports_tools]
        if not tool_models:
            tool_models = models

        def _cost(pair: tuple[str, ModelInfo]) -> float:
            p = MODEL_PRICING.get(pair[1].id, (0.0, 0.0))
            return p[0] + p[1]

        best = min(tool_models, key=_cost)
        return best[0], best[1].id

    def _best(self, models: list[tuple[str, ModelInfo]]) -> tuple[str, str]:
        """Highest capability — use cost as proxy (most expensive = most capable)."""
        def _cost(pair: tuple[str, ModelInfo]) -> float:
            p = MODEL_PRICING.get(pair[1].id, (0.0, 0.0))
            return p[0] + p[1]

        best = max(models, key=_cost)
        return best[0], best[1].id

    def _local_first(self, models: list[tuple[str, ModelInfo]]) -> tuple[str, str]:
        """Prefer local (Ollama) providers, fall back to cloud."""
        local = [(n, m) for n, m in models if n.lower() in ("ollama", "local")]
        if local:
            return local[0][0], local[0][1].id
        # Fall back to balanced
        return self._balanced(models)

    def _fast(self, models: list[tuple[str, ModelInfo]]) -> tuple[str, str]:
        """Smallest/fastest model — smallest context window as proxy."""
        best = min(models, key=lambda p: p[1].context_window)
        return best[0], best[1].id

    def _balanced(self, models: list[tuple[str, ModelInfo]]) -> tuple[str, str]:
        """Reasonable cost-quality tradeoff.

        Score = supports_tools * 10 + context_window_score - cost_score.
        Picks the model with the best composite score.
        """
        def _score(pair: tuple[str, ModelInfo]) -> float:
            m = pair[1]
            pricing = MODEL_PRICING.get(m.id, (0.0, 0.0))
            cost = pricing[0] + pricing[1]
            tool_bonus = 10.0 if m.supports_tools else 0.0
            # Normalize context: 128k = 1.0
            ctx_score = min(m.context_window / 128_000, 1.0) * 5.0
            # Penalize cost (scale so $10/mtok total = -5 points)
            cost_penalty = cost / 2.0
            return tool_bonus + ctx_score - cost_penalty

        best = max(models, key=_score)
        return best[0], best[1].id
