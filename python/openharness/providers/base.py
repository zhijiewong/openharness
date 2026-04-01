"""Abstract base class for LLM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from openharness.core.config import ProviderConfig
from openharness.core.events import Event
from openharness.core.types import Message, ModelInfo, ToolSpec


class BaseProvider(ABC):
    """Every LLM provider implements this interface."""

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def complete(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> Message:
        """Send messages and get a complete response (non-streaming)."""

    @abstractmethod
    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolSpec] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[Event]:
        """Stream response events (TextDelta, ToolCallStart, CostUpdate, etc.)."""

    @abstractmethod
    def list_models(self) -> list[ModelInfo]:
        """List available models from this provider."""

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is reachable."""
