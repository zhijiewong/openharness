"""Configuration management for OpenHarness."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .exceptions import ConfigError

# Default directories
DEFAULT_OH_HOME = Path.home() / ".oh"
DEFAULT_CONFIG_PATH = DEFAULT_OH_HOME / "config.yaml"


@dataclass
class ProviderConfig:
    """Configuration for an LLM provider."""

    name: str
    api_key: str | None = None
    base_url: str = ""
    default_model: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentConfig:
    """Top-level configuration for the agent."""

    # Provider / model defaults
    provider: str = "ollama"
    model: str = "llama3"

    # Enabled tools (empty = all available)
    tools: list[str] = field(default_factory=list)

    # Rules file paths
    rules_paths: list[str] = field(default_factory=list)

    # Permission mode: "ask", "trust", "deny"
    permission_mode: str = "ask"

    # Cost ceiling (USD).  0 = unlimited
    max_cost_per_session: float = 0.0

    # Directories
    oh_home: Path = field(default_factory=lambda: DEFAULT_OH_HOME)
    session_dir: Path = field(default_factory=lambda: DEFAULT_OH_HOME / "sessions")
    memory_dir: Path = field(default_factory=lambda: DEFAULT_OH_HOME / "memory")

    # Per-provider configs
    providers: dict[str, ProviderConfig] = field(default_factory=dict)

    # --------------- persistence helpers ---------------

    @classmethod
    def load(cls, path: Path | None = None) -> AgentConfig:
        """Load config from a YAML file. Falls back to defaults."""
        path = path or DEFAULT_CONFIG_PATH
        if not path.exists():
            return cls()
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            raise ConfigError(f"Failed to parse {path}: {exc}") from exc

        providers: dict[str, ProviderConfig] = {}
        for name, prov_raw in raw.pop("providers", {}).items():
            providers[name] = ProviderConfig(name=name, **prov_raw)

        # Map YAML keys to dataclass fields, coercing types
        _PATH_FIELDS = {"oh_home", "session_dir", "memory_dir"}
        config = cls(providers=providers)
        for key, val in raw.items():
            key = key.replace("-", "_")
            if hasattr(config, key):
                if key in _PATH_FIELDS and isinstance(val, str):
                    val = Path(val)
                setattr(config, key, val)
        return config

    def save(self, path: Path | None = None) -> None:
        """Persist current config to YAML."""
        path = path or DEFAULT_CONFIG_PATH
        path.parent.mkdir(parents=True, exist_ok=True)

        data: dict[str, Any] = {
            "provider": self.provider,
            "model": self.model,
            "permission_mode": self.permission_mode,
        }
        if self.tools:
            data["tools"] = self.tools
        if self.max_cost_per_session:
            data["max_cost_per_session"] = self.max_cost_per_session
        if self.providers:
            data["providers"] = {
                name: {
                    k: v
                    for k, v in {
                        "api_key": p.api_key,
                        "base_url": p.base_url or None,
                        "default_model": p.default_model or None,
                        **p.extra,
                    }.items()
                    if v is not None
                }
                for name, p in self.providers.items()
            }

        path.write_text(yaml.dump(data, default_flow_style=False), encoding="utf-8")

    def get_provider_config(self, name: str | None = None) -> ProviderConfig:
        """Get config for a named provider, or the default."""
        name = name or self.provider
        return self.providers.get(name, ProviderConfig(name=name))
