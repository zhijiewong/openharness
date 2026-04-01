"""FileReadTool — read file contents with optional line range."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext

MAX_LINES = 2000


class FileReadTool(BaseTool):
    """Read a file's contents, optionally specifying line range."""

    @property
    def name(self) -> str:
        return "Read"

    @property
    def description(self) -> str:
        return (
            "Read a file from the filesystem. Returns the file contents with line numbers. "
            "Use offset and limit to read specific sections of large files."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to read.",
                },
                "offset": {
                    "type": "integer",
                    "description": "Line number to start reading from (1-based). Default: 1.",
                },
                "limit": {
                    "type": "integer",
                    "description": f"Maximum number of lines to read. Default: {MAX_LINES}.",
                },
            },
            "required": ["file_path"],
        }

    @property
    def risk_level(self) -> RiskLevel:
        return RiskLevel.LOW

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        return True

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        file_path = arguments["file_path"]
        offset = max(1, arguments.get("offset", 1))
        limit = min(arguments.get("limit", MAX_LINES), MAX_LINES)

        # Resolve relative to working directory
        path = Path(file_path)
        if not path.is_absolute():
            path = context.working_dir / path

        if not path.exists():
            return ToolResult(call_id="", output=f"Error: File not found: {file_path}", is_error=True)

        if not path.is_file():
            return ToolResult(call_id="", output=f"Error: Not a file: {file_path}", is_error=True)

        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except PermissionError:
            return ToolResult(call_id="", output=f"Error: Permission denied: {file_path}", is_error=True)
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error reading file: {exc}", is_error=True)

        lines = text.splitlines()
        total_lines = len(lines)

        # Apply offset and limit
        start = offset - 1  # 0-based
        end = start + limit
        selected = lines[start:end]

        # Format with line numbers
        numbered = "\n".join(f"{start + i + 1}\t{line}" for i, line in enumerate(selected))

        if not numbered:
            return ToolResult(call_id="", output="(empty file)")

        result = numbered
        if end < total_lines:
            result += f"\n\n... ({total_lines - end} more lines)"

        return ToolResult(call_id="", output=result)
