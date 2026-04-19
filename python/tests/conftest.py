"""Test fixtures shared across the openHarness Python SDK test suite."""

from __future__ import annotations

import os
import stat
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest


def _write_stub(dir_: Path, name: str, py_body: str) -> Path:
    """Drop a tiny Python launcher on disk + make it executable.

    On Unix we write a shebanged shell-dispatching script; on Windows the
    ``.bat`` wrapper forwards to the current Python interpreter. Either way
    a subprocess spawned with the resolved path runs ``py_body``.
    """
    if os.name == "nt":
        # Windows: write a .bat that forwards to python + a .py sibling
        py_path = dir_ / f"{name}.py"
        py_path.write_text(py_body)
        bat_path = dir_ / f"{name}.bat"
        bat_path.write_text(f'@echo off\r\n"{sys.executable}" "{py_path}" %*\r\n')
        # The Python SDK's find_oh_binary uses shutil.which which resolves .bat on Windows.
        return bat_path
    # Unix: single script with a shebang
    py_path = dir_ / name
    py_path.write_text(f"#!{sys.executable}\n{py_body}")
    st = py_path.stat()
    py_path.chmod(st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return py_path


@pytest.fixture
def oh_stub(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Install a fake `oh` on PATH that emits a canned NDJSON stream.

    The stub reads its argv and emits a hard-coded event sequence. Tests that
    need different behavior should use :func:`make_oh_stub` directly.
    """
    body = '''
import sys, json
out = [
    {"type": "text", "content": "hello"},
    {"type": "text", "content": " world"},
    {"type": "turn_complete", "reason": "completed"},
]
for e in out:
    print(json.dumps(e), flush=True)
'''
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_stub(bin_dir, "oh", body)
    monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.delenv("OH_BINARY", raising=False)
    yield bin_dir


@pytest.fixture
def make_oh_stub(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Factory: install a stub `oh` with a caller-supplied Python body.

    Returns a function ``(body: str) -> Path`` that writes the stub and
    arranges PATH so ``shutil.which("oh")`` picks it up.
    """

    counter = {"n": 0}

    def _make(body: str) -> Path:
        counter["n"] += 1
        bin_dir = tmp_path / f"bin-{counter['n']}"
        bin_dir.mkdir()
        _write_stub(bin_dir, "oh", body)
        monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ.get("PATH", ""))
        monkeypatch.delenv("OH_BINARY", raising=False)
        return bin_dir

    return _make
