"""Session persistence — save and resume conversations."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .config import DEFAULT_OH_HOME
from .types import Message, Role, ToolCall, ToolResult


def _default_session_dir() -> Path:
    return DEFAULT_OH_HOME / "sessions"


@dataclass
class Session:
    """A conversation session that can be persisted to disk."""

    id: str = field(default_factory=lambda: uuid4().hex[:12])
    messages: list[Message] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    provider: str = ""
    model: str = ""
    total_cost: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0

    # ---- message helpers ----

    def add_message(self, message: Message) -> None:
        self.messages.append(message)
        self.updated_at = datetime.now(timezone.utc)

    def add_user_message(self, content: str) -> Message:
        msg = Message(role=Role.USER, content=content)
        self.add_message(msg)
        return msg

    def add_assistant_message(
        self,
        content: str,
        tool_calls: tuple[ToolCall, ...] = (),
    ) -> Message:
        msg = Message(role=Role.ASSISTANT, content=content, tool_calls=tool_calls)
        self.add_message(msg)
        return msg

    def add_tool_result(self, call_id: str, output: str, is_error: bool = False) -> Message:
        result = ToolResult(call_id=call_id, output=output, is_error=is_error)
        msg = Message(role=Role.TOOL, content=output, tool_results=(result,))
        self.add_message(msg)
        return msg

    # ---- persistence ----

    def _to_dict(self) -> dict:
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "provider": self.provider,
            "model": self.model,
            "total_cost": self.total_cost,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "messages": [
                {
                    "role": m.role.value,
                    "content": m.content,
                    "uuid": m.uuid,
                    "timestamp": m.timestamp.isoformat(),
                    "tool_calls": [
                        {"id": tc.id, "tool_name": tc.tool_name, "arguments": tc.arguments}
                        for tc in m.tool_calls
                    ],
                    "tool_results": [
                        {"call_id": tr.call_id, "output": tr.output, "is_error": tr.is_error}
                        for tr in m.tool_results
                    ],
                }
                for m in self.messages
                if not m.is_meta
            ],
        }

    @classmethod
    def _from_dict(cls, data: dict) -> Session:
        messages: list[Message] = []
        for m in data.get("messages", []):
            messages.append(
                Message(
                    role=Role(m["role"]),
                    content=m["content"],
                    uuid=m.get("uuid", uuid4().hex),
                    timestamp=datetime.fromisoformat(m["timestamp"]) if m.get("timestamp") else datetime.now(timezone.utc),
                    tool_calls=tuple(
                        ToolCall(id=tc["id"], tool_name=tc["tool_name"], arguments=tc["arguments"])
                        for tc in m.get("tool_calls", [])
                    ),
                    tool_results=tuple(
                        ToolResult(call_id=tr["call_id"], output=tr["output"], is_error=tr.get("is_error", False))
                        for tr in m.get("tool_results", [])
                    ),
                )
            )
        return cls(
            id=data["id"],
            created_at=datetime.fromisoformat(data["created_at"]),
            updated_at=datetime.fromisoformat(data["updated_at"]),
            provider=data.get("provider", ""),
            model=data.get("model", ""),
            total_cost=data.get("total_cost", 0.0),
            total_input_tokens=data.get("total_input_tokens", 0),
            total_output_tokens=data.get("total_output_tokens", 0),
            messages=messages,
        )

    def save(self, session_dir: Path | None = None) -> Path:
        """Persist session to a JSON file. Returns the file path."""
        session_dir = session_dir or _default_session_dir()
        session_dir.mkdir(parents=True, exist_ok=True)
        path = session_dir / f"{self.id}.json"
        path.write_text(json.dumps(self._to_dict(), indent=2), encoding="utf-8")
        return path

    @classmethod
    def load(cls, session_id: str, session_dir: Path | None = None) -> Session:
        """Load a session from disk."""
        session_dir = session_dir or _default_session_dir()
        path = session_dir / f"{session_id}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls._from_dict(data)

    @classmethod
    def list_all(cls, session_dir: Path | None = None) -> list[dict]:
        """List all saved sessions (id, model, updated_at, message count)."""
        session_dir = session_dir or _default_session_dir()
        if not session_dir.exists():
            return []
        sessions = []
        for path in sorted(session_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                sessions.append({
                    "id": data["id"],
                    "model": data.get("model", ""),
                    "updated_at": data.get("updated_at", ""),
                    "messages": len(data.get("messages", [])),
                    "cost": data.get("total_cost", 0.0),
                })
            except (json.JSONDecodeError, KeyError):
                continue
        return sessions
