"""Provider registry — discover and manage LLM providers."""

from __future__ import annotations

from openharness.core.config import ProviderConfig
from openharness.core.exceptions import ProviderNotFoundError
from openharness.core.types import ModelInfo

from .base import BaseProvider


class ProviderRegistry:
    """Central registry for LLM providers."""

    def __init__(self) -> None:
        self._providers: dict[str, BaseProvider] = {}
        self._factories: dict[str, type[BaseProvider]] = {}

    def register_factory(self, name: str, factory: type[BaseProvider]) -> None:
        """Register a provider class that can be instantiated later."""
        self._factories[name] = factory

    def register(self, name: str, provider: BaseProvider) -> None:
        """Register a pre-built provider instance."""
        self._providers[name] = provider

    def get(self, name: str) -> BaseProvider:
        """Get a provider by name. Raises ProviderNotFoundError if not found."""
        if name in self._providers:
            return self._providers[name]
        raise ProviderNotFoundError(f"Provider '{name}' not registered")

    def get_or_create(self, name: str, config: ProviderConfig) -> BaseProvider:
        """Get existing provider or create from registered factory."""
        if name in self._providers:
            return self._providers[name]
        if name in self._factories:
            provider = self._factories[name](config)
            self._providers[name] = provider
            return provider
        raise ProviderNotFoundError(
            f"Provider '{name}' not registered. Available: {list(self._factories.keys())}"
        )

    def list_all_models(self) -> list[ModelInfo]:
        """List models across all registered providers."""
        models: list[ModelInfo] = []
        for provider in self._providers.values():
            models.extend(provider.list_models())
        return models

    @property
    def available(self) -> list[str]:
        """Names of all registered providers and factories."""
        return sorted(set(self._providers.keys()) | set(self._factories.keys()))
