"""FileEditTool — find and replace strings in files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext


class FileEditTool(BaseTool):
    """Find old_string in a file and replace it with new_string."""

    @property
    def name(self) -> str:
        return "Edit"

    @property
    def description(self) -> str:
        return (
            "Perform exact string replacements in a file. "
            "Finds old_string and replaces it with new_string. "
            "Fails if old_string is not found or matches multiple times (unless replace_all is true)."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to edit.",
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact text to find in the file.",
                },
                "new_string": {
                    "type": "string",
                    "description": "The text to replace old_string with.",
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "Replace all occurrences of old_string. Default: false.",
                },
            },
            "required": ["file_path", "old_string", "new_string"],
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
        old_string = arguments["old_string"]
        new_string = arguments["new_string"]
        replace_all = arguments.get("replace_all", False)

        # Resolve relative to working directory
        path = Path(file_path)
        if not path.is_absolute():
            path = context.working_dir / path

        if not path.exists():
            return ToolResult(call_id="", output=f"Error: File not found: {file_path}", is_error=True)

        if not path.is_file():
            return ToolResult(call_id="", output=f"Error: Not a file: {file_path}", is_error=True)

        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except PermissionError:
            return ToolResult(call_id="", output=f"Error: Permission denied: {file_path}", is_error=True)
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error reading file: {exc}", is_error=True)

        # Check occurrences
        count = content.count(old_string)
        if count == 0:
            return ToolResult(
                call_id="",
                output=f"Error: old_string not found in {file_path}",
                is_error=True,
            )

        if count > 1 and not replace_all:
            return ToolResult(
                call_id="",
                output=(
                    f"Error: old_string found {count} times in {file_path}. "
                    "Use replace_all=true to replace all occurrences, "
                    "or provide a more specific old_string."
                ),
                is_error=True,
            )

        # Perform replacement
        if replace_all:
            new_content = content.replace(old_string, new_string)
        else:
            new_content = content.replace(old_string, new_string, 1)

        try:
            path.write_text(new_content, encoding="utf-8")
        except PermissionError:
            return ToolResult(call_id="", output=f"Error: Permission denied writing: {file_path}", is_error=True)
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error writing file: {exc}", is_error=True)

        # Build diff-like output
        old_lines = old_string.splitlines()
        new_lines = new_string.splitlines()
        diff_parts = []
        for line in old_lines:
            diff_parts.append(f"- {line}")
        for line in new_lines:
            diff_parts.append(f"+ {line}")
        diff_output = "\n".join(diff_parts)

        replacements = f"{count} replacement(s)" if replace_all else "1 replacement"
        return ToolResult(
            call_id="",
            output=f"Edited {file_path} ({replacements}):\n{diff_output}",
        )
