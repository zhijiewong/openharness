"""FileWriteTool — write content to a file, creating parent directories as needed."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext


class FileWriteTool(BaseTool):
    """Write content to a file, creating it (and parent directories) if needed."""

    @property
    def name(self) -> str:
        return "Write"

    @property
    def description(self) -> str:
        return (
            "Write content to a file. Creates parent directories if they don't exist. "
            "Overwrites the file if it already exists. "
            "Returns confirmation with the file path and line count."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to write.",
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file.",
                },
            },
            "required": ["file_path", "content"],
        }

    @property
    def risk_level(self) -> RiskLevel:
        return RiskLevel.MEDIUM

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        return False

    def is_concurrency_safe(self, arguments: dict[str, Any]) -> bool:
        return False

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = arguments["file_path"]
        content = arguments["content"]

        # Resolve relative to working directory
        path = Path(file_path)
        if not path.is_absolute():
            path = context.working_dir / path

        # Create parent directories if needed
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
        except PermissionError:
            return ToolResult(
                call_id="",
                output=f"Error: Permission denied creating directory: {path.parent}",
                is_error=True,
            )
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error creating directories: {exc}", is_error=True)

        # Write the file
        try:
            path.write_text(content, encoding="utf-8")
        except PermissionError:
            return ToolResult(call_id="", output=f"Error: Permission denied: {file_path}", is_error=True)
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error writing file: {exc}", is_error=True)

        line_count = len(content.splitlines())
        existed = "Overwrote" if path.exists() else "Created"
        return ToolResult(
            call_id="",
            output=f"{existed} {file_path} ({line_count} lines)",
        )
