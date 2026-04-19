"""Tests for openharness._binary."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from openharness import OhBinaryNotFoundError
from openharness._binary import find_oh_binary


def test_find_oh_binary_honors_OH_BINARY_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = tmp_path / "oh"
    fake.write_text("#!/bin/sh\necho stub\n")
    fake.chmod(0o755)
    monkeypatch.setenv("OH_BINARY", str(fake))
    assert find_oh_binary() == str(fake)


def test_find_oh_binary_falls_back_to_PATH(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Create a fake `oh` in a temp dir and put that dir on PATH.
    fake = tmp_path / ("oh.exe" if os.name == "nt" else "oh")
    fake.write_text("#!/bin/sh\necho stub\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.delenv("OH_BINARY", raising=False)
    resolved = find_oh_binary()
    # shutil.which returns a path with the resolved extension on Windows
    assert Path(resolved).name.startswith("oh")


def test_find_oh_binary_raises_when_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))  # empty dir
    monkeypatch.delenv("OH_BINARY", raising=False)
    with pytest.raises(OhBinaryNotFoundError) as exc:
        find_oh_binary()
    assert "npm install -g @zhijiewang/openharness" in str(exc.value)


def test_find_oh_binary_ignores_nonexistent_OH_BINARY(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OH_BINARY", str(tmp_path / "does-not-exist"))
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(OhBinaryNotFoundError):
        find_oh_binary()
