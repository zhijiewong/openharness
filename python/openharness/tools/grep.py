"""GrepTool — search file contents using regex."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext

MAX_MATCHES = 100


class GrepTool(BaseTool):
    """Search file contents using regular expressions."""

    @property
    def name(self) -> str:
        return "Grep"

    @property
    def description(self) -> str:
        return (
            "Search file contents using a regular expression pattern. "
            "Returns matching lines with file paths and line numbers. "
            "Optionally filter by file glob and show context lines."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regular expression pattern to search for.",
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in. Defaults to the current working directory.",
                },
                "glob": {
                    "type": "string",
                    "description": "Glob pattern to filter files (e.g. '*.py', '**/*.ts').",
                },
                "context": {
                    "type": "integer",
                    "description": "Number of lines of context to show before and after each match.",
                },
            },
            "required": ["pattern"],
        }

    @property
    def risk_level(self) -> RiskLevel:
        return RiskLevel.LOW

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        return True

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        pattern_str = arguments["pattern"]
        search_path = arguments.get("path")
        file_glob = arguments.get("glob", "**/*")
        ctx_lines = max(0, arguments.get("context", 0))

        try:
            regex = re.compile(pattern_str)
        except re.error as exc:
            return ToolResult(call_id="", output=f"Error: Invalid regex: {exc}", is_error=True)

        # Resolve base path
        if search_path:
            base = Path(search_path)
            if not base.is_absolute():
                base = context.working_dir / base
        else:
            base = context.working_dir

        if not base.exists():
            return ToolResult(call_id="", output=f"Error: Path not found: {base}", is_error=True)

        # Collect files to search
        if base.is_file():
            files = [base]
        else:
            try:
                files = sorted(p for p in base.glob(file_glob) if p.is_file())
            except Exception as exc:
                return ToolResult(call_id="", output=f"Error: Invalid glob pattern: {exc}", is_error=True)

        matches: list[str] = []
        match_count = 0

        for file_path in files:
            if match_count >= MAX_MATCHES:
                break

            try:
                text = file_path.read_text(encoding="utf-8", errors="replace")
            except (PermissionError, OSError):
                continue

            lines = text.splitlines()
            for i, line in enumerate(lines):
                if match_count >= MAX_MATCHES:
                    break

                if regex.search(line):
                    match_count += 1

                    # Relative path for display
                    try:
                        display_path = str(file_path.relative_to(context.working_dir))
                    except ValueError:
                        display_path = str(file_path)

                    if ctx_lines > 0:
                        start = max(0, i - ctx_lines)
                        end = min(len(lines), i + ctx_lines + 1)
                        context_block = []
                        for j in range(start, end):
                            prefix = ">" if j == i else " "
                            context_block.append(f"  {prefix} {j + 1}\t{lines[j]}")
                        matches.append(f"{display_path}:{i + 1}:\n" + "\n".join(context_block))
                    else:
                        matches.append(f"{display_path}:{i + 1}:\t{line}")

        if not matches:
            return ToolResult(call_id="", output=f"No matches found for pattern: {pattern_str}")

        result = "\n".join(matches)
        if match_count >= MAX_MATCHES:
            result += f"\n\n... (stopped at {MAX_MATCHES} matches)"

        return ToolResult(call_id="", output=result)
