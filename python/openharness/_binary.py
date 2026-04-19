"""Locate the `oh` CLI binary on PATH (or via the OH_BINARY env var)."""

from __future__ import annotations

import os
import shutil

from .exceptions import OhBinaryNotFoundError

__all__ = ["find_oh_binary"]


def find_oh_binary() -> str:
    """Return the absolute path to the `oh` CLI executable.

    Resolution order:
      1. ``OH_BINARY`` environment variable if set and points to an existing file.
      2. ``shutil.which("oh")`` — first `oh` on PATH.

    :raises OhBinaryNotFoundError: if neither source yields a usable path.
    """
    override = os.environ.get("OH_BINARY")
    if override and os.path.isfile(override):
        return override
    found = shutil.which("oh")
    if found:
        return found
    raise OhBinaryNotFoundError()
