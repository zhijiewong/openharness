"""Tests for openharness.core.config."""

from pathlib import Path

from openharness.core.config import AgentConfig, ProviderConfig


class TestAgentConfig:
    def test_defaults(self):
        cfg = AgentConfig()
        assert cfg.provider == "ollama"
        assert cfg.model == "llama3"
        assert cfg.permission_mode == "ask"
        assert cfg.max_cost_per_session == 0.0
        assert isinstance(cfg.oh_home, Path)
        assert isinstance(cfg.session_dir, Path)

    def test_save_load_roundtrip(self, tmp_path):
        cfg = AgentConfig(provider="openai", model="gpt-4o", permission_mode="trust")
        path = tmp_path / "config.yaml"
        cfg.save(path)
        loaded = AgentConfig.load(path)
        assert loaded.provider == "openai"
        assert loaded.model == "gpt-4o"
        assert loaded.permission_mode == "trust"

    def test_load_nonexistent_returns_defaults(self, tmp_path):
        cfg = AgentConfig.load(tmp_path / "nope.yaml")
        assert cfg.provider == "ollama"

    def test_provider_config_creation(self):
        pc = ProviderConfig(name="openai", api_key="sk-test", base_url="https://api.openai.com")
        assert pc.name == "openai"
        assert pc.api_key == "sk-test"

    def test_with_providers_roundtrip(self, tmp_path):
        cfg = AgentConfig(
            provider="openai",
            model="gpt-4o",
            providers={
                "openai": ProviderConfig(name="openai", api_key="sk-123", default_model="gpt-4o"),
            },
        )
        path = tmp_path / "config.yaml"
        cfg.save(path)
        loaded = AgentConfig.load(path)
        assert "openai" in loaded.providers
        assert loaded.providers["openai"].api_key == "sk-123"

    def test_path_fields_are_path_objects(self, tmp_path):
        path = tmp_path / "config.yaml"
        # Write yaml with string paths
        path.write_text(
            "provider: ollama\nmodel: llama3\npermission_mode: ask\n"
            "oh_home: /tmp/test_oh\nsession_dir: /tmp/test_sessions\n",
            encoding="utf-8",
        )
        loaded = AgentConfig.load(path)
        assert isinstance(loaded.oh_home, Path)
        assert isinstance(loaded.session_dir, Path)
