"""Machine-facing bridge for non-Python clients.

This is an early stdio bridge intended for a future TypeScript/Node.js CLI.
It currently supports a minimal request envelope and a small set of methods.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
import asyncio

from openharness import __version__
from openharness.agent.loop import AgentLoop
from openharness.agent.permissions import PermissionGate
from openharness.core.events import ErrorEvent, TextDelta, ToolCallEnd, ToolCallStart, TurnComplete
from openharness.core.config import AgentConfig, DEFAULT_CONFIG_PATH, ProviderConfig
from openharness.core.session import Session
from openharness.harness.cost import CostTracker, MODEL_PRICING
from openharness.harness.memory import MemorySystem
from openharness.harness.rules import RulesLoader
from openharness.harness.skills import SkillRegistry

from oh.cli.chat import _build_provider, _build_tools, _load_system_prompt
from oh.cli.main import _guess_provider


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


async def _read_json_line() -> dict[str, Any] | None:
    line = await asyncio.to_thread(sys.stdin.readline)
    if not line:
        return None
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def _result(req_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": req_id,
        "event": "result",
        "data": data,
    }


def _error(req_id: str, code: str, message: str, **data: Any) -> dict[str, Any]:
    return {
        "id": req_id,
        "event": "error",
        "data": {
            "code": code,
            "message": message,
            **data,
        },
    }


def _mask_api_key(key: str | None) -> str:
    """Mask API key for safe transmission — never send full keys over stdio."""
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return f"***{key[-4:]}"


def _serialize_config(config: AgentConfig) -> dict[str, Any]:
    return {
        "path": str(DEFAULT_CONFIG_PATH),
        "provider": config.provider,
        "model": config.model,
        "permission_mode": config.permission_mode,
        "max_cost_per_session": config.max_cost_per_session,
        "tools": config.tools,
        "providers": {
            name: {
                "api_key": _mask_api_key(provider.api_key),
                "base_url": provider.base_url,
                "default_model": provider.default_model,
            }
            for name, provider in config.providers.items()
        },
    }


def _resolve_config_path(params: dict[str, Any]) -> Path | None:
    raw_path = params.get("config_path")
    if not raw_path:
        return None
    return Path(str(raw_path))


def _resolve_path_param(params: dict[str, Any], key: str) -> Path | None:
    raw_path = params.get(key)
    if not raw_path:
        return None
    return Path(str(raw_path))


def _serialize_tools() -> list[dict[str, Any]]:
    tools = _build_tools()
    return [
        {
            "name": tool.name,
            "risk": tool.risk_level.value,
            "read_only": tool.is_read_only({}),
            "description": tool.description,
        }
        for tool in tools.tools
    ]


def _serialize_models(provider: str | None = None) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []

    if not provider or provider == "ollama":
        from openharness.providers.ollama import OllamaProvider

        ollama = OllamaProvider(ProviderConfig(name="ollama"))
        for model in ollama.list_models():
            models.append(
                {
                    "id": model.id,
                    "provider": model.provider,
                    "context_window": model.context_window,
                    "supports_tools": model.supports_tools,
                    "supports_streaming": model.supports_streaming,
                    "supports_vision": model.supports_vision,
                    "input_cost_per_mtok": model.input_cost_per_mtok,
                    "output_cost_per_mtok": model.output_cost_per_mtok,
                }
            )

    if not provider or provider != "ollama":
        for model_name, (inp, out) in sorted(MODEL_PRICING.items()):
            if inp == 0:
                continue
            if provider and provider not in model_name:
                continue
            models.append(
                {
                    "id": model_name,
                    "provider": _guess_provider(model_name),
                    "context_window": None,
                    "supports_tools": True,
                    "supports_streaming": True,
                    "supports_vision": False,
                    "input_cost_per_mtok": inp,
                    "output_cost_per_mtok": out,
                }
            )

    return models


def _serialize_sessions(session_dir: Path | None = None) -> list[dict[str, Any]]:
    return Session.list_all(session_dir=session_dir)


def _serialize_costs(cost_dir: Path) -> dict[str, Any]:
    if not cost_dir.exists():
        return {
            "has_data": False,
            "summary": None,
            "by_provider": {},
            "events": 0,
        }

    total_tracker = CostTracker()
    for cost_file in sorted(cost_dir.glob("*.json")):
        try:
            tracker = CostTracker.load(cost_file)
            for event in tracker.events:
                total_tracker.record(
                    provider=event.provider,
                    model=event.model,
                    input_tokens=event.input_tokens,
                    output_tokens=event.output_tokens,
                    cost=event.cost,
                    label=event.label,
                )
        except Exception:
            continue

    return {
        "has_data": bool(total_tracker.events),
        "summary": total_tracker.format_summary() if total_tracker.events else None,
        "by_provider": total_tracker.by_provider(),
        "events": len(total_tracker.events),
        "total_cost": total_tracker.total_cost,
        "total_input_tokens": total_tracker.total_input_tokens,
        "total_output_tokens": total_tracker.total_output_tokens,
    }


def _serialize_rules(project_path: Path | None = None, create: bool = False) -> dict[str, Any]:
    loader = RulesLoader(project_path=project_path or Path.cwd())
    created_path = None
    if create:
        created_path = str(loader.create_rules_file())
    files = loader.rules_files
    prompt = loader.load_as_prompt()
    return {
        "created_path": created_path,
        "files": [str(path) for path in files],
        "prompt_length": len(prompt),
    }


def _serialize_skills(project_path: Path | None = None) -> dict[str, Any]:
    registry = SkillRegistry()
    count = registry.load_all(project_path=project_path or Path.cwd())
    return {
        "count": count,
        "skills": [
            {
                "name": skill.name,
                "source": skill.source,
                "context": skill.context,
                "description": skill.description,
                "when_to_use": skill.when_to_use,
                "model": skill.model,
            }
            for skill in registry.list_all()
        ],
    }


def _serialize_memories(memory_dir: Path, search: str | None = None) -> dict[str, Any]:
    mem = MemorySystem(memory_dir)
    memories = mem.search(search) if search else mem.load_all()
    return {
        "count": len(memories),
        "memories": [
            {
                "id": memory.id,
                "type": memory.type,
                "title": memory.title,
                "description": memory.description,
                "created_at": memory.created_at.isoformat(),
                "file_path": str(memory.file_path) if memory.file_path else None,
            }
            for memory in memories
        ],
    }


def _init_project(project_path: Path, config_path: Path | None = None) -> dict[str, Any]:
    project_path.mkdir(parents=True, exist_ok=True)
    oh_dir = project_path / ".oh"
    created: list[str] = []
    oh_dir.mkdir(parents=True, exist_ok=True)

    loader = RulesLoader(project_path=project_path)
    rules_file = oh_dir / "RULES.md"
    if not rules_file.exists():
        loader.create_rules_file()
        created.append(str(rules_file))

    skills_dir = oh_dir / "skills"
    skills_dir.mkdir(exist_ok=True)
    if not list(skills_dir.glob("*.md")):
        created.append(str(skills_dir))

    resolved_config_path = config_path or DEFAULT_CONFIG_PATH
    if not resolved_config_path.exists():
        config = AgentConfig()
        config.save(resolved_config_path)
        created.append(str(resolved_config_path))

    return {
        "project_path": str(project_path),
        "created": created,
        "already_initialized": not created,
    }


def _set_config_value(config: AgentConfig, key: str, value: Any) -> None:
    if key.startswith("providers."):
        parts = key.split(".", 2)
        if len(parts) != 3:
            raise ValueError(f"Invalid provider key: {key}")

        _, prov_name, field = parts
        if prov_name not in config.providers:
            config.providers[prov_name] = ProviderConfig(name=prov_name)

        provider = config.providers[prov_name]
        if field == "api_key":
            provider.api_key = str(value)
        elif field == "base_url":
            provider.base_url = str(value)
        elif field == "default_model":
            provider.default_model = str(value)
        else:
            provider.extra[field] = value
        return

    if not hasattr(config, key):
        raise ValueError(f"Unknown config key: {key}")

    current = getattr(config, key)
    if isinstance(current, float):
        setattr(config, key, float(value))
    elif isinstance(current, int):
        setattr(config, key, int(value))
    elif isinstance(current, list) and not isinstance(value, list):
        setattr(config, key, [value])
    else:
        setattr(config, key, value)


def _handle(request: dict[str, Any]) -> dict[str, Any]:
    req_id = str(request.get("id", "unknown"))
    method = request.get("method")

    if method == "app.version":
        return _result(
            req_id,
            {
                "version": __version__,
                "name": "OpenHarness",
            },
        )

    if method == "config.show":
        params = request.get("params", {})
        config_path = _resolve_config_path(params)
        config = AgentConfig.load(config_path)
        data = _serialize_config(config)
        data["path"] = str(config_path or DEFAULT_CONFIG_PATH)
        return _result(req_id, data)

    if method == "config.set":
        params = request.get("params", {})
        key = params.get("key")
        if not key:
            return _error(req_id, "missing_key", "config.set requires a 'key' parameter.")

        if "value" not in params:
            return _error(req_id, "missing_value", "config.set requires a 'value' parameter.")

        try:
            config_path = _resolve_config_path(params)
            config = AgentConfig.load(config_path)
            _set_config_value(config, str(key), params["value"])
            config.save(config_path)
        except ValueError as exc:
            return _error(req_id, "invalid_config_key", str(exc))
        except Exception as exc:
            return _error(req_id, "config_save_failed", str(exc))

        return _result(
            req_id,
            {
                "updated": str(key),
                "value": params["value"],
                "path": str(config_path or DEFAULT_CONFIG_PATH),
            },
        )

    if method == "sessions.list":
        params = request.get("params", {})
        session_dir = _resolve_path_param(params, "session_dir")
        return _result(req_id, {"sessions": _serialize_sessions(session_dir)})

    if method == "cost.summary":
        params = request.get("params", {})
        cost_dir = _resolve_path_param(params, "cost_dir")
        if cost_dir is None:
            cost_dir = AgentConfig.load().oh_home / "costs"
        return _result(req_id, _serialize_costs(cost_dir))

    if method == "tools.list":
        return _result(req_id, {"tools": _serialize_tools()})

    if method == "models.list":
        params = request.get("params", {})
        provider = params.get("provider")
        return _result(req_id, {"models": _serialize_models(str(provider) if provider else None)})

    if method == "rules.list":
        params = request.get("params", {})
        project_path = _resolve_path_param(params, "project_path")
        create = bool(params.get("create", False))
        return _result(req_id, _serialize_rules(project_path=project_path, create=create))

    if method == "skills.list":
        params = request.get("params", {})
        project_path = _resolve_path_param(params, "project_path")
        return _result(req_id, _serialize_skills(project_path=project_path))

    if method == "memory.list":
        params = request.get("params", {})
        memory_dir = _resolve_path_param(params, "memory_dir") or AgentConfig.load().memory_dir
        search = params.get("search")
        return _result(req_id, _serialize_memories(memory_dir, str(search) if search else None))

    if method == "project.init":
        params = request.get("params", {})
        project_path = _resolve_path_param(params, "project_path") or Path.cwd()
        config_path = _resolve_config_path(params)
        try:
            return _result(req_id, _init_project(project_path=project_path, config_path=config_path))
        except Exception as exc:
            return _error(req_id, "init_failed", str(exc))

    return _error(req_id, "unknown_method", f"Unknown method: {method}")


async def _run_chat_turn(req_id: str, params: dict[str, Any]) -> None:
    prompt = str(params.get("prompt", "")).strip()
    if not prompt:
        _write(_error(req_id, "missing_prompt", "chat.start requires a non-empty 'prompt'."))
        return

    model = params.get("model")
    permission_mode = str(params.get("permission_mode", "deny"))
    resume = params.get("resume")
    session_dir = _resolve_path_param(params, "session_dir")

    config = AgentConfig.load()
    provider, resolved_model = _build_provider(config, model if isinstance(model, str) else None)
    tools = _build_tools()

    async def _ask_permission(tool_name: str, description: str, arguments: dict[str, Any]) -> bool:
        _write(
            {
                "id": req_id,
                "event": "permission_request",
                "data": {
                    "tool_name": tool_name,
                    "description": description,
                    "arguments": arguments,
                },
            }
        )

        while True:
            response = await _read_json_line()
            if not response:
                return False
            if response.get("method") != "permission.response":
                continue
            allow = response.get("params", {}).get("allow", False)
            return bool(allow)

    gate = PermissionGate(
        mode=permission_mode,
        ask_user=_ask_permission if permission_mode == "ask" else None,
    )
    if isinstance(resume, str) and resume.strip():
        try:
            session = Session.load(resume.strip(), session_dir=session_dir)
        except FileNotFoundError:
            _write(_error(req_id, "session_not_found", f"Session '{resume}' was not found."))
            return
    else:
        session = Session(provider=config.provider, model=resolved_model or config.model)

    healthy = await provider.health_check()
    if not healthy:
        _write(_error(req_id, "provider_unavailable", "Cannot connect to the configured LLM provider."))
        return

    rules_prompt = ""
    project_context = ""
    memory_prompt = ""

    try:
        from openharness.harness.rules import RulesLoader
        from openharness.harness.onboarding import ProjectDetector
        from openharness.harness.memory import MemorySystem

        rules_loader = RulesLoader(project_path=Path.cwd())
        rules_prompt = rules_loader.load_as_prompt()

        detector = ProjectDetector()
        ctx = detector.detect()
        project_context = detector.generate_system_context(ctx)

        mem = MemorySystem(config.memory_dir)
        memory_prompt = mem.build_prompt_section()
    except Exception:
        pass

    agent = AgentLoop(
        provider=provider,
        tools=tools,
        permission_gate=gate,
        session=session,
        system_prompt=_load_system_prompt(),
        rules_prompt=rules_prompt,
        project_context=project_context,
        memory_prompt=memory_prompt,
        working_dir=Path.cwd(),
        max_cost=config.max_cost_per_session,
        hooks=None,
    )

    _write(
        {
            "id": req_id,
            "event": "session_start",
            "data": {
                "model": resolved_model or config.model,
                "provider": config.provider,
                "permission_mode": permission_mode,
                "tools": tools.names,
                "session_id": session.id,
                "resumed": bool(isinstance(resume, str) and resume.strip()),
            },
        }
    )

    async for event in agent.run(prompt):
        if isinstance(event, TextDelta):
            _write({"id": req_id, "event": "text_delta", "data": {"content": event.content}})
        elif isinstance(event, ToolCallStart):
            _write(
                {
                    "id": req_id,
                    "event": "tool_call_start",
                    "data": {"tool_name": event.tool_name, "call_id": event.call_id},
                }
            )
        elif isinstance(event, ToolCallEnd):
            _write(
                {
                    "id": req_id,
                    "event": "tool_call_end",
                    "data": {
                        "call_id": event.call_id,
                        "output": event.output,
                        "is_error": event.is_error,
                    },
                }
            )
        elif isinstance(event, ErrorEvent):
            _write(
                {
                    "id": req_id,
                    "event": "error",
                    "data": {"code": "agent_error", "message": event.message},
                }
            )
        elif isinstance(event, TurnComplete):
            session_path = session.save(session_dir=session_dir)
            _write(
                {
                    "id": req_id,
                    "event": "turn_complete",
                    "data": {
                        "reason": event.reason,
                        "session_id": session.id,
                        "session_path": str(session_path),
                    },
                }
            )


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _write(
                {
                    "id": "invalid",
                    "event": "error",
                    "data": {
                        "code": "invalid_json",
                        "message": str(exc),
                    },
                }
            )
            continue

        if request.get("method") == "chat.start":
            asyncio.run(_run_chat_turn(str(request.get("id", "unknown")), request.get("params", {})))
            break

        _write(_handle(request))


if __name__ == "__main__":
    main()
