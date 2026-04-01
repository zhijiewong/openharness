"""Memory system — persistent memory files with YAML frontmatter and a searchable index.

Mirrors Claude Code's memdir: memories are stored as .md files with metadata
frontmatter.  A MEMORY.md index file provides the LLM with a compact summary
of all available memories.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

MEMORY_TYPES = ("user", "feedback", "project", "reference")
MAX_INDEX_LINES = 200
MAX_INDEX_BYTES = 25_000

INDEX_FILENAME = "MEMORY.md"


@dataclass
class Memory:
    """A single memory entry."""

    id: str  # filename without extension
    type: str  # One of MEMORY_TYPES
    title: str
    description: str
    content: str
    created_at: datetime
    file_path: Path | None = None


# ---------------------------------------------------------------------------
# Frontmatter helpers (shared pattern with skills.py)
# ---------------------------------------------------------------------------

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from a markdown string.

    Returns (frontmatter_dict, body_text).
    """
    text = text.lstrip()
    if not text.startswith("---"):
        return {}, text

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


def _memory_to_markdown(memory: Memory) -> str:
    """Serialize a Memory to a markdown string with YAML frontmatter."""
    front: dict[str, Any] = {
        "name": memory.title,
        "description": memory.description,
        "type": memory.type,
        "created_at": memory.created_at.isoformat(),
    }
    yaml_block = yaml.dump(front, default_flow_style=False).strip()
    return f"---\n{yaml_block}\n---\n\n{memory.content}\n"


# ---------------------------------------------------------------------------
# MemorySystem
# ---------------------------------------------------------------------------

class MemorySystem:
    """Manage persistent memories stored as markdown files."""

    def __init__(self, memory_dir: Path) -> None:
        self.memory_dir = memory_dir

    def save(self, memory: Memory) -> Path:
        """Save a memory to disk as a markdown file with frontmatter.

        Also updates the MEMORY.md index.
        """
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{memory.id}.md"
        path = self.memory_dir / filename
        path.write_text(_memory_to_markdown(memory), encoding="utf-8")

        memory.file_path = path
        self.update_index()
        return path

    def search(self, query: str) -> list[Memory]:
        """Search memories by keyword in title, description, and content.

        Simple case-insensitive substring matching.
        """
        query_lower = query.lower()
        results: list[Memory] = []
        for mem in self.load_all():
            if (
                query_lower in mem.title.lower()
                or query_lower in mem.description.lower()
                or query_lower in mem.content.lower()
            ):
                results.append(mem)
        return results

    def load_all(self) -> list[Memory]:
        """Load all memories from the memory directory.

        Scans ``*.md`` files excluding the ``MEMORY.md`` index.
        """
        if not self.memory_dir.is_dir():
            return []

        memories: list[Memory] = []
        for md_file in sorted(self.memory_dir.glob("*.md")):
            if md_file.name == INDEX_FILENAME:
                continue

            try:
                text = md_file.read_text(encoding="utf-8")
            except OSError as exc:
                logger.warning("Could not read %s: %s", md_file, exc)
                continue

            front, body = _parse_frontmatter(text)
            if not front:
                continue

            # Parse created_at
            raw_ts = front.get("created_at")
            if isinstance(raw_ts, datetime):
                created_at = raw_ts
            elif isinstance(raw_ts, str):
                try:
                    created_at = datetime.fromisoformat(raw_ts)
                except ValueError:
                    created_at = datetime.now(timezone.utc)
            else:
                created_at = datetime.now(timezone.utc)

            mem = Memory(
                id=md_file.stem,
                type=front.get("type", "user"),
                title=front.get("name", md_file.stem),
                description=front.get("description", ""),
                content=body,
                created_at=created_at,
                file_path=md_file,
            )
            memories.append(mem)

        return memories

    def load_index(self) -> str:
        """Load MEMORY.md index content, truncated to size limits."""
        index_path = self.memory_dir / INDEX_FILENAME
        if not index_path.is_file():
            return ""

        try:
            text = index_path.read_text(encoding="utf-8")
        except OSError:
            return ""

        # Truncate to byte limit
        if len(text.encode("utf-8")) > MAX_INDEX_BYTES:
            text = text.encode("utf-8")[:MAX_INDEX_BYTES].decode(
                "utf-8", errors="ignore"
            )

        # Truncate to line limit
        lines = text.splitlines()
        if len(lines) > MAX_INDEX_LINES:
            lines = lines[:MAX_INDEX_LINES]
            text = "\n".join(lines)

        return text

    def update_index(self) -> None:
        """Rebuild MEMORY.md index from all memory files.

        Writes one line per memory in the format:
        ``- [Title](filename.md) -- description``

        Truncated to MAX_INDEX_LINES.
        """
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        memories = self.load_all()
        lines = ["# Memories", ""]

        for mem in memories[:MAX_INDEX_LINES - 2]:  # Reserve header lines
            filename = f"{mem.id}.md"
            line = f"- [{mem.title}]({filename})"
            if mem.description:
                line += f" -- {mem.description}"
            lines.append(line)

        index_path = self.memory_dir / INDEX_FILENAME
        index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def forget(self, memory_id: str) -> bool:
        """Delete a memory file and update the index.

        Returns True if the memory was found and deleted.
        """
        path = self.memory_dir / f"{memory_id}.md"
        if not path.is_file():
            return False

        path.unlink()
        self.update_index()
        return True

    def build_prompt_section(self) -> str:
        """Build the memory section for injection into the system prompt.

        Returns the MEMORY.md content (truncated) for the LLM to see.
        """
        index = self.load_index()
        if not index:
            return ""
        return f"<memories>\n{index}\n</memories>"
