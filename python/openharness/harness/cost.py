"""Cost tracking system — per-model token and cost tracking with budget enforcement.

Mirrors Claude Code's cost-tracker.ts: per-model usage, session persistence,
formatted dashboard, budget checks.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class ModelUsage:
    """Token usage and cost for a single model."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    requests: int = 0

    def add(
        self,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost: float = 0.0,
        cache_read: int = 0,
        cache_write: int = 0,
    ) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.cost_usd += cost
        self.cache_read_tokens += cache_read
        self.cache_write_tokens += cache_write
        self.requests += 1


@dataclass
class CostEvent:
    """A single cost-generating event."""

    timestamp: datetime
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost: float
    label: str = "chat"  # "chat", "sub-agent", "compact", "tool"


class CostTracker:
    """Track costs across the session with per-model breakdown.

    Mirrors Claude Code's cost-tracker.ts pattern.
    """

    def __init__(self, budget: float = 0.0) -> None:
        self.budget = budget  # 0 = unlimited
        self.events: list[CostEvent] = []
        self.model_usage: dict[str, ModelUsage] = {}
        self._total_cost: float = 0.0
        self._total_input_tokens: int = 0
        self._total_output_tokens: int = 0

    def record(
        self,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost: float,
        label: str = "chat",
    ) -> None:
        """Record a cost event."""
        event = CostEvent(
            timestamp=datetime.now(timezone.utc),
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
            label=label,
        )
        self.events.append(event)

        # Update totals
        self._total_cost += cost
        self._total_input_tokens += input_tokens
        self._total_output_tokens += output_tokens

        # Update per-model usage
        if model not in self.model_usage:
            self.model_usage[model] = ModelUsage()
        self.model_usage[model].add(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
        )

    @property
    def total_cost(self) -> float:
        return self._total_cost

    @property
    def total_input_tokens(self) -> int:
        return self._total_input_tokens

    @property
    def total_output_tokens(self) -> int:
        return self._total_output_tokens

    def is_over_budget(self) -> bool:
        """Check if spending has exceeded the budget."""
        return self.budget > 0 and self._total_cost >= self.budget

    def budget_remaining(self) -> float | None:
        """Remaining budget in USD, or None if unlimited."""
        if self.budget <= 0:
            return None
        return max(0.0, self.budget - self._total_cost)

    def by_provider(self) -> dict[str, float]:
        """Total cost by provider."""
        result: dict[str, float] = {}
        for event in self.events:
            result[event.provider] = result.get(event.provider, 0.0) + event.cost
        return result

    def by_model(self) -> dict[str, float]:
        """Total cost by model."""
        return {model: usage.cost_usd for model, usage in self.model_usage.items()}

    # ---- persistence ----

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_cost": self._total_cost,
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "budget": self.budget,
            "model_usage": {
                model: {
                    "input_tokens": u.input_tokens,
                    "output_tokens": u.output_tokens,
                    "cache_read_tokens": u.cache_read_tokens,
                    "cache_write_tokens": u.cache_write_tokens,
                    "cost_usd": u.cost_usd,
                    "requests": u.requests,
                }
                for model, u in self.model_usage.items()
            },
            "events": [
                {
                    "timestamp": e.timestamp.isoformat(),
                    "provider": e.provider,
                    "model": e.model,
                    "input_tokens": e.input_tokens,
                    "output_tokens": e.output_tokens,
                    "cost": e.cost,
                    "label": e.label,
                }
                for e in self.events
            ],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CostTracker:
        tracker = cls(budget=data.get("budget", 0.0))
        tracker._total_cost = data.get("total_cost", 0.0)
        tracker._total_input_tokens = data.get("total_input_tokens", 0)
        tracker._total_output_tokens = data.get("total_output_tokens", 0)
        for model, u in data.get("model_usage", {}).items():
            tracker.model_usage[model] = ModelUsage(
                input_tokens=u.get("input_tokens", 0),
                output_tokens=u.get("output_tokens", 0),
                cache_read_tokens=u.get("cache_read_tokens", 0),
                cache_write_tokens=u.get("cache_write_tokens", 0),
                cost_usd=u.get("cost_usd", 0.0),
                requests=u.get("requests", 0),
            )
        for e in data.get("events", []):
            tracker.events.append(
                CostEvent(
                    timestamp=datetime.fromisoformat(e["timestamp"]),
                    provider=e["provider"],
                    model=e["model"],
                    input_tokens=e["input_tokens"],
                    output_tokens=e["output_tokens"],
                    cost=e["cost"],
                    label=e.get("label", "chat"),
                )
            )
        return tracker

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> CostTracker:
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls.from_dict(data)

    # ---- display ----

    def format_summary(self) -> str:
        """Format a cost summary for terminal display."""
        lines = [
            f"Total cost:           ${self._total_cost:.4f}",
            f"Total tokens:         {self._total_input_tokens:,} input, {self._total_output_tokens:,} output",
        ]
        if self.budget > 0:
            remaining = self.budget_remaining() or 0
            lines.append(f"Budget remaining:     ${remaining:.4f} / ${self.budget:.2f}")

        if self.model_usage:
            lines.append("\nUsage by model:")
            for model, usage in sorted(self.model_usage.items()):
                lines.append(
                    f"  {model:30s} {usage.input_tokens:>8,} in, "
                    f"{usage.output_tokens:>8,} out, "
                    f"{usage.requests:>3} requests  "
                    f"(${usage.cost_usd:.4f})"
                )

        return "\n".join(lines)


# ---- Model pricing registry ----

MODEL_PRICING: dict[str, tuple[float, float]] = {
    # (input_cost_per_mtok, output_cost_per_mtok)
    # OpenAI
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "o3-mini": (1.10, 4.40),
    "o3": (10.00, 40.00),
    # Anthropic
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (0.80, 4.00),
    "claude-opus-4-6": (15.00, 75.00),
    # DeepSeek
    "deepseek-chat": (0.14, 0.28),
    "deepseek-coder": (0.14, 0.28),
    # Qwen
    "qwen-turbo": (0.20, 0.60),
    # Local (free)
    "llama3": (0.0, 0.0),
    "llama3:8b": (0.0, 0.0),
    "mistral": (0.0, 0.0),
    "codellama": (0.0, 0.0),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost for a given model and token count."""
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        # Try prefix match
        for known_model, p in MODEL_PRICING.items():
            if model.startswith(known_model):
                pricing = p
                break
    if not pricing:
        return 0.0

    input_cost = (input_tokens / 1_000_000) * pricing[0]
    output_cost = (output_tokens / 1_000_000) * pricing[1]
    return input_cost + output_cost
