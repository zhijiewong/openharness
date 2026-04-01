"""BashTool — execute shell commands with timeout and safety checks."""

from __future__ import annotations

import asyncio
import os
import subprocess
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext

DEFAULT_TIMEOUT = 120  # seconds
MAX_OUTPUT_CHARS = 100_000


class BashTool(BaseTool):
    """Execute a shell command and return its output."""

    @property
    def name(self) -> str:
        return "Bash"

    @property
    def description(self) -> str:
        return (
            "Execute a bash command and return its stdout and stderr. "
            "Commands run in the current working directory. "
            "Use this for system operations, running tests, git commands, etc."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute.",
                },
                "timeout": {
                    "type": "integer",
                    "description": f"Timeout in seconds. Default: {DEFAULT_TIMEOUT}.",
                },
            },
            "required": ["command"],
        }

    @property
    def risk_level(self) -> RiskLevel:
        return RiskLevel.HIGH

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        # Bash commands can do anything — never read-only
        return False

    def is_concurrency_safe(self, arguments: dict[str, Any]) -> bool:
        return False

    async def validate_input(self, arguments: dict[str, Any], context: ToolContext) -> str | None:
        command = arguments.get("command", "").strip()
        if not command:
            return "Command cannot be empty."
        return None

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        command = arguments["command"]
        timeout = min(arguments.get("timeout", DEFAULT_TIMEOUT), 600)  # Max 10 minutes

        try:
            # Detect shell
            shell = _get_shell()

            flag = _shell_flag(shell)
            proc = await asyncio.create_subprocess_exec(
                shell,
                flag,
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(context.working_dir),
                env={**os.environ},
            )

            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return ToolResult(
                    call_id="",
                    output=f"Error: Command timed out after {timeout}s",
                    is_error=True,
                )

            stdout_text = stdout.decode("utf-8", errors="replace") if stdout else ""
            stderr_text = stderr.decode("utf-8", errors="replace") if stderr else ""

            output_parts: list[str] = []
            if stdout_text:
                output_parts.append(stdout_text)
            if stderr_text:
                output_parts.append(stderr_text)
            if proc.returncode and proc.returncode != 0:
                output_parts.append(f"\nExit code: {proc.returncode}")

            output = "\n".join(output_parts) or "(no output)"

            # Truncate if too long
            if len(output) > MAX_OUTPUT_CHARS:
                output = output[:MAX_OUTPUT_CHARS] + f"\n\n... (truncated, {len(output)} total chars)"

            return ToolResult(
                call_id="",
                output=output,
                is_error=proc.returncode != 0,
            )

        except FileNotFoundError:
            return ToolResult(call_id="", output="Error: Shell not found", is_error=True)
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error: {exc}", is_error=True)


def _shell_flag(shell: str) -> str:
    """Get the correct command-execution flag for the shell."""
    if shell == "cmd":
        return "/C"
    if shell == "powershell":
        return "-Command"
    return "-c"


def _get_shell() -> str:
    """Get the appropriate shell for the current platform."""
    if os.name == "nt":
        # Prefer bash (Git Bash, WSL) on Windows, fall back to cmd
        for shell in ["bash", "sh"]:
            if _shell_exists(shell):
                return shell
        return "cmd"
    return os.environ.get("SHELL", "/bin/sh")


def _shell_exists(name: str) -> bool:
    try:
        subprocess.run([name, "--version"], capture_output=True, timeout=3)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
