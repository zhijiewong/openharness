"""Skills system — load and manage LLM skills from markdown files with YAML frontmatter.

Mirrors Claude Code's skill loading: skills are .md files with YAML frontmatter
defining metadata and a markdown body providing instructions for the LLM.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from ..core.config import DEFAULT_OH_HOME

logger = logging.getLogger(__name__)


@dataclass
class Skill:
    """A single skill definition."""

    name: str
    description: str
    content: str  # The full markdown body (instructions for the LLM)
    when_to_use: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    model: str | None = None
    context: str = "inline"  # "inline" or "fork"
    source: str = "disk"  # "disk", "builtin", "plugin"


# ---------------------------------------------------------------------------
# Frontmatter parsing
# ---------------------------------------------------------------------------

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from a markdown string.

    Returns (frontmatter_dict, body_text).  If no valid frontmatter is
    found the entire text is returned as the body.
    """
    text = text.lstrip()
    if not text.startswith("---"):
        return {}, text

    # Find the closing --- marker (skip the opening one)
    end_idx = text.find("---", 3)
    if end_idx == -1:
        return {}, text

    front_raw = text[3:end_idx].strip()
    body = text[end_idx + 3:].strip()

    try:
        front = yaml.safe_load(front_raw) or {}
    except yaml.YAMLError as exc:
        logger.warning("Failed to parse YAML frontmatter: %s", exc)
        return {}, text

    if not isinstance(front, dict):
        return {}, text

    return front, body


def _skill_from_frontmatter(front: dict, body: str, source: str = "disk") -> Skill:
    """Create a Skill from parsed frontmatter and body text."""
    return Skill(
        name=front.get("name", ""),
        description=front.get("description", ""),
        content=body,
        when_to_use=front.get("whenToUse", front.get("when_to_use", "")),
        allowed_tools=front.get("allowedTools", front.get("allowed_tools", [])),
        model=front.get("model"),
        context=front.get("context", "inline"),
        source=source,
    )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class SkillRegistry:
    """Central registry of loaded skills."""

    def __init__(self) -> None:
        self._skills: dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        """Register a skill (overwrites if name already exists)."""
        if not skill.name:
            logger.warning("Skipping skill with empty name")
            return
        self._skills[skill.name] = skill

    def get(self, name: str) -> Skill | None:
        """Look up a skill by name."""
        return self._skills.get(name)

    def list_all(self) -> list[Skill]:
        """Return all registered skills."""
        return list(self._skills.values())

    # ---- loading ----

    def load_from_directory(self, path: Path, source: str = "disk") -> int:
        """Load skills from a directory of .md files with YAML frontmatter.

        Each .md file has::

            ---
            name: skill-name
            description: What this skill does
            whenToUse: When to activate
            allowedTools: [Read, Bash]
            model: gpt-4o
            context: inline
            ---

            Skill body markdown content here...

        Returns count of skills loaded.
        """
        if not path.is_dir():
            return 0

        count = 0
        for md_file in sorted(path.glob("*.md")):
            try:
                text = md_file.read_text(encoding="utf-8")
            except OSError as exc:
                logger.warning("Could not read %s: %s", md_file, exc)
                continue

            front, body = _parse_frontmatter(text)
            if not front.get("name"):
                # Fall back to filename as name
                front.setdefault("name", md_file.stem)

            skill = _skill_from_frontmatter(front, body, source=source)
            self.register(skill)
            count += 1

        return count

    def load_builtin_skills(self, skills_dir: Path) -> int:
        """Load built-in skills from data/skills/ directory."""
        return self.load_from_directory(skills_dir, source="builtin")

    def load_all(self, project_path: Path | None = None) -> int:
        """Load skills from all sources: builtin, global, project.

        Load order (later sources overwrite earlier ones for same name):
        1. Built-in skills from data/skills/
        2. Global skills from ~/.oh/skills/
        3. Project skills from <project>/.oh/skills/ (if project_path given)

        Returns total count of skills loaded.
        """
        total = 0

        # 1. Built-in skills (check multiple locations)
        builtin_dir = Path(__file__).resolve().parent.parent.parent / "data" / "skills"
        if not builtin_dir.is_dir():
            builtin_dir = Path(__file__).resolve().parent.parent / "data" / "skills"
        total += self.load_builtin_skills(builtin_dir)

        # 2. Global skills
        global_dir = DEFAULT_OH_HOME / "skills"
        total += self.load_from_directory(global_dir, source="disk")

        # 3. Project-local skills
        if project_path is not None:
            project_skills = Path(project_path) / ".oh" / "skills"
            total += self.load_from_directory(project_skills, source="disk")

        return total
