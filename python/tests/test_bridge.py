from __future__ import annotations

from pathlib import Path
from uuid import uuid4
import shutil

from oh import bridge


def _make_workspace_tmp(name: str) -> Path:
    path = Path("tests") / ".tmp" / f"{name}-{uuid4().hex[:8]}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_bridge_version() -> None:
    response = bridge._handle({"id": "1", "method": "app.version"})
    assert response["event"] == "result"
    assert response["data"]["name"] == "OpenHarness"


def test_bridge_config_show_and_set() -> None:
    tmp_path = _make_workspace_tmp("bridge-config")
    config_path = tmp_path / "config.yaml"

    try:
        set_response = bridge._handle(
            {
                "id": "2",
                "method": "config.set",
                "params": {
                    "key": "provider",
                    "value": "openai",
                    "config_path": str(config_path),
                },
            }
        )
        assert set_response["event"] == "result"

        show_response = bridge._handle(
            {
                "id": "3",
                "method": "config.show",
                "params": {
                    "config_path": str(config_path),
                },
            }
        )
        assert show_response["event"] == "result"
        assert show_response["data"]["provider"] == "openai"
        assert show_response["data"]["path"] == str(config_path)
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)


def test_bridge_project_init() -> None:
    tmp_path = _make_workspace_tmp("bridge-init")
    project_path = tmp_path / "demo-project"
    config_path = tmp_path / "demo-config.yaml"

    try:
        response = bridge._handle(
            {
                "id": "4",
                "method": "project.init",
                "params": {
                    "project_path": str(project_path),
                    "config_path": str(config_path),
                },
            }
        )

        assert response["event"] == "result"
        assert (project_path / ".oh" / "RULES.md").exists()
        assert (project_path / ".oh" / "skills").exists()
        assert config_path.exists()
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)
