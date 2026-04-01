"""GlobTool — find files matching a glob pattern."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext

MAX_RESULTS = 500


class GlobTool(BaseTool):
    """Find files matching a glob pattern using pathlib."""

    @property
    def name(self) -> str:
        return "Glob"

    @property
    def description(self) -> str:
        return (
            "Fast file pattern matching tool. "
            "Supports glob patterns like '**/*.py' or 'src/**/*.ts'. "
            "Returns matching file paths sorted alphabetically."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The glob pattern to match files against (e.g. '**/*.py').",
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in. Defaults to the current working directory.",
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
        pattern = arguments["pattern"]
        search_path = arguments.get("path")

        # Resolve base directory
        if search_path:
            base = Path(search_path)
            if not base.is_absolute():
                base = context.working_dir / base
        else:
            base = context.working_dir

        if not base.exists():
            return ToolResult(call_id="", output=f"Error: Directory not found: {base}", is_error=True)

        if not base.is_dir():
            return ToolResult(call_id="", output=f"Error: Not a directory: {base}", is_error=True)

        try:
            matches = sorted(base.glob(pattern))
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error: Invalid glob pattern: {exc}", is_error=True)

        # Filter to files only and limit results
        files = [p for p in matches if p.is_file()]

        if not files:
            return ToolResult(call_id="", output=f"No files matched pattern: {pattern}")

        truncated = len(files) > MAX_RESULTS
        files = files[:MAX_RESULTS]

        # Return paths relative to working directory where possible
        lines = []
        for f in files:
            try:
                lines.append(str(f.relative_to(context.working_dir)))
            except ValueError:
                lines.append(str(f))

        result = "\n".join(lines)
        if truncated:
            result += f"\n\n... (truncated, showing {MAX_RESULTS} of {len(matches)} matches)"

        return ToolResult(call_id="", output=result)
