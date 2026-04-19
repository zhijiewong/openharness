"""Exception types raised by the openHarness SDK."""

from __future__ import annotations

__all__ = ["OhBinaryNotFoundError", "OpenHarnessError"]


class OpenHarnessError(Exception):
    """Raised when the `oh` subprocess exits non-zero or produces invalid output.

    :param message: Short human-readable reason.
    :param stderr: The subprocess's stderr, if available. Useful for diagnostics.
    :param exit_code: Subprocess exit code if the error is from a completed run.
    """

    def __init__(
        self,
        message: str,
        *,
        stderr: str | None = None,
        exit_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.stderr = stderr
        self.exit_code = exit_code


class OhBinaryNotFoundError(OpenHarnessError):
    """Raised when the `oh` CLI cannot be located on PATH.

    Fix by installing openHarness via npm::

        npm install -g @zhijiewang/openharness

    Or by setting the ``OH_BINARY`` environment variable to the absolute path
    of the ``oh`` executable.
    """

    def __init__(self) -> None:
        super().__init__(
            "The 'oh' CLI was not found on PATH. "
            "Install it with: npm install -g @zhijiewang/openharness "
            "(or set OH_BINARY to the absolute path of the 'oh' executable)."
        )
