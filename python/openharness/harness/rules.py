"""Rules system — load project and global rules into agent context.

Mirrors Claude Code's CLAUDE.md / .claude/rules/ pattern.
Discovery order:
1. ~/.oh/global-rules/*.md  (user-wide)
2. .oh/RULES.md             (project main rules)
3. .oh/rules/*.md           (project rule files)
"""

from __future__ import annotations

from pathlib import Path

from openharness.core.config import DEFAULT_OH_HOME


class RulesLoader:
    """Discover and merge rules from project and global sources."""

    def __init__(
        self,
        project_path: Path | None = None,
        oh_home: Path = DEFAULT_OH_HOME,
    ) -> None:
        self.project_path = project_path or Path.cwd()
        self.oh_home = oh_home

    def load(self) -> list[str]:
        """Load and merge all applicable rules. Returns list of rule strings."""
        rules: list[str] = []

        # 1. Global rules
        global_rules_dir = self.oh_home / "global-rules"
        if global_rules_dir.is_dir():
            for path in sorted(global_rules_dir.glob("*.md")):
                content = self._read_rule(path)
                if content:
                    rules.append(content)

        # 2. Project main rules (.oh/RULES.md)
        project_rules = self.project_path / ".oh" / "RULES.md"
        if project_rules.is_file():
            content = self._read_rule(project_rules)
            if content:
                rules.append(content)

        # 3. Project rule files (.oh/rules/*.md)
        project_rules_dir = self.project_path / ".oh" / "rules"
        if project_rules_dir.is_dir():
            for path in sorted(project_rules_dir.glob("*.md")):
                content = self._read_rule(path)
                if content:
                    rules.append(content)

        return rules

    def load_as_prompt(self) -> str:
        """Load all rules and format as a system prompt section."""
        rules = self.load()
        if not rules:
            return ""

        sections = []
        for i, rule in enumerate(rules):
            sections.append(rule)

        return (
            "# Project Rules\n\n"
            "The following rules have been loaded for this project. "
            "Follow them carefully.\n\n"
            + "\n\n---\n\n".join(sections)
        )

    def create_rules_file(self) -> Path:
        """Initialize .oh/RULES.md for the current project."""
        rules_dir = self.project_path / ".oh"
        rules_dir.mkdir(parents=True, exist_ok=True)
        rules_file = rules_dir / "RULES.md"

        if rules_file.exists():
            return rules_file

        rules_file.write_text(
            "# Project Rules\n\n"
            "Add rules here that the AI agent should follow when working on this project.\n\n"
            "## Examples\n\n"
            "- Always run tests after making changes\n"
            "- Use type hints in all Python code\n"
            "- Follow PEP 8 style guidelines\n"
            "- Never commit directly to main branch\n",
            encoding="utf-8",
        )
        return rules_file

    @property
    def rules_files(self) -> list[Path]:
        """List all discovered rule files."""
        files: list[Path] = []

        global_dir = self.oh_home / "global-rules"
        if global_dir.is_dir():
            files.extend(sorted(global_dir.glob("*.md")))

        project_rules = self.project_path / ".oh" / "RULES.md"
        if project_rules.is_file():
            files.append(project_rules)

        project_dir = self.project_path / ".oh" / "rules"
        if project_dir.is_dir():
            files.extend(sorted(project_dir.glob("*.md")))

        return files

    @staticmethod
    def _read_rule(path: Path) -> str:
        """Read a rule file, stripping leading/trailing whitespace."""
        try:
            content = path.read_text(encoding="utf-8").strip()
            return content if content else ""
        except (OSError, UnicodeDecodeError):
            return ""
