"""oh chat — interactive chat with the agent."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import typer

from openharness import __version__
from openharness.agent.loop import AgentLoop
from openharness.agent.permissions import PermissionGate
from openharness.core.config import AgentConfig, ProviderConfig
from openharness.core.events import (
    CostUpdate,
    ErrorEvent,
    TextDelta,
    ToolCallEnd,
    ToolCallStart,
    TurnComplete,
)
from openharness.core.session import Session
from openharness.providers.ollama import OllamaProvider
from openharness.tools.bash import BashTool
from openharness.tools.file_read import FileReadTool
from openharness.tools.registry import ToolRegistry
from openharness.harness.cost import CostTracker, estimate_cost

from . import ui

def _load_system_prompt() -> str:
    """Load system prompt from data/prompts/system.md or use default."""
    prompt_path = Path(__file__).resolve().parent.parent.parent / "data" / "prompts" / "system.md"
    if prompt_path.is_file():
        return prompt_path.read_text(encoding="utf-8")
    return (
        "You are an AI coding assistant running in the terminal. You help users with "
        "software engineering tasks by reading files, editing code, and running commands. "
        "You have access to tools. Use them to accomplish the user's request. "
        "Be concise and direct. Focus on what needs to be done."
    )


def _build_provider(config: AgentConfig, model_override: str | None) -> tuple[Any, str]:
    """Build the appropriate provider based on config."""
    provider_name = config.provider
    model = model_override or config.model

    # Parse "provider/model" format
    if model and "/" in model:
        parts = model.split("/", 1)
        provider_name = parts[0]
        model = parts[1]

    prov_config = config.get_provider_config(provider_name)
    prov_config = ProviderConfig(
        name=provider_name,
        api_key=prov_config.api_key,
        base_url=prov_config.base_url,
        default_model=model or prov_config.default_model,
    )

    if provider_name == "ollama":
        return OllamaProvider(prov_config), model

    # Try OpenAI-compatible providers
    try:
        if provider_name == "openai":
            from openharness.providers.openai import OpenAIProvider
            return OpenAIProvider(prov_config), model
        elif provider_name == "anthropic":
            from openharness.providers.anthropic import AnthropicProvider
            return AnthropicProvider(prov_config), model
        elif provider_name == "openrouter":
            from openharness.providers.openrouter import OpenRouterProvider
            return OpenRouterProvider(prov_config), model
        else:
            # Treat as OpenAI-compatible (DeepSeek, Qwen, Groq, Mistral, etc.)
            from openharness.providers.openai_compat import OpenAICompatProvider
            return OpenAICompatProvider(prov_config), model
    except ImportError:
        ui.console.print(f"[yellow]Provider '{provider_name}' not available. Falling back to Ollama.[/yellow]")
        return OllamaProvider(prov_config), model


def _build_tools() -> ToolRegistry:
    """Build the default tool registry with all available tools."""
    registry = ToolRegistry()
    registry.register(FileReadTool())
    registry.register(BashTool())

    # Register Phase 2 tools if available
    try:
        from openharness.tools.file_edit import FileEditTool
        from openharness.tools.file_write import FileWriteTool
        from openharness.tools.glob_tool import GlobTool
        from openharness.tools.grep import GrepTool
        from openharness.tools.web_fetch import WebFetchTool

        registry.register(FileEditTool())
        registry.register(FileWriteTool())
        registry.register(GlobTool())
        registry.register(GrepTool())
        registry.register(WebFetchTool())
    except ImportError:
        pass

    return registry


async def _ask_user_permission(tool_name: str, description: str, arguments: dict) -> bool:
    """Callback for permission gate to ask user."""
    return ui.ask_permission(tool_name, description)


async def _run_chat(
    model: str | None,
    resume: str | None,
    permission_mode: str,
) -> None:
    """Main chat loop."""
    config = AgentConfig.load()

    # Build components
    provider, resolved_model = _build_provider(config, model)
    tools = _build_tools()
    gate = PermissionGate(mode=permission_mode, ask_user=_ask_user_permission)

    # Load or create session
    if resume:
        try:
            session = Session.load(resume)
            ui.console.print(f"[dim]Resumed session {session.id}[/dim]")
        except FileNotFoundError:
            ui.console.print(f"[red]Session '{resume}' not found.[/red]")
            return
    else:
        session = Session(provider=config.provider, model=resolved_model or config.model)

    # Check provider health
    healthy = await provider.health_check()
    if not healthy:
        provider_name = config.provider
        ui.console.print(f"[red]Cannot connect to LLM provider ({provider_name}).[/red]")
        if provider_name == "ollama":
            ui.console.print("[dim]Start Ollama: ollama serve[/dim]")
        elif provider_name in ("openai", "anthropic", "openrouter"):
            ui.console.print(f"[dim]Check your API key: oh config set providers.{provider_name}.api_key YOUR_KEY[/dim]")
        else:
            ui.console.print(f"[dim]Check provider configuration: oh config show[/dim]")
        return

    # Load harness features
    rules_prompt = ""
    project_context = ""
    memory_prompt = ""
    hooks = None

    try:
        from openharness.harness.rules import RulesLoader
        from openharness.harness.onboarding import ProjectDetector
        from openharness.harness.hooks import HookSystem

        # Rules
        rules_loader = RulesLoader(project_path=Path.cwd())
        rules_prompt = rules_loader.load_as_prompt()

        # Project detection
        detector = ProjectDetector()
        ctx = detector.detect()
        project_context = detector.generate_system_context(ctx)

        # Memory
        try:
            from openharness.harness.memory import MemorySystem
            mem = MemorySystem(config.memory_dir)
            memory_prompt = mem.build_prompt_section()
        except Exception:
            pass

        # Hooks
        hooks_file = Path.cwd() / ".oh" / "hooks.yaml"
        if hooks_file.is_file():
            hooks = HookSystem()
            hooks.load_from_yaml(hooks_file)
    except ImportError:
        pass

    # Print header
    extras = []
    if rules_prompt:
        extras.append("rules")
    if memory_prompt:
        extras.append("memory")
    if hooks and hooks.hook_count > 0:
        extras.append(f"{hooks.hook_count} hooks")
    ui.console.print()
    ui.print_startup_banner(
        version=__version__,
        model=resolved_model or config.model,
        permission_mode=permission_mode,
        tools=tools.names,
        extras=extras,
    )
    ui.console.print()

    cost_tracker = CostTracker(budget=config.max_cost_per_session)

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
        hooks=hooks,
    )

    while True:
        try:
            user_input = ui.console.input("[bold green]> [/bold green]").strip()
        except (EOFError, KeyboardInterrupt):
            ui.console.print("\n[dim]Goodbye.[/dim]")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "/exit", "/quit"):
            break

        ui.console.print()

        try:
            async for event in agent.run(user_input):
                if isinstance(event, TextDelta):
                    ui.print_assistant(event.content)
                elif isinstance(event, ToolCallStart):
                    ui.print_tool_call(event.tool_name, event.call_id)
                elif isinstance(event, ToolCallEnd):
                    ui.print_tool_result(event.output, event.is_error)
                elif isinstance(event, CostUpdate):
                    cost_tracker.record(
                        provider=config.provider,
                        model=event.model,
                        input_tokens=event.input_tokens,
                        output_tokens=event.output_tokens,
                        cost=event.cost or estimate_cost(event.model, event.input_tokens, event.output_tokens),
                    )
                    ui.print_cost(event.input_tokens, event.output_tokens, cost_tracker.total_cost, event.model)
                elif isinstance(event, ErrorEvent):
                    ui.print_error(event.message)
                elif isinstance(event, TurnComplete):
                    pass  # Normal completion
        except KeyboardInterrupt:
            ui.console.print("\n[dim]Interrupted.[/dim]")
        except Exception as exc:
            ui.print_error(str(exc))

        ui.console.print()

    # Save session and costs
    session.total_cost = cost_tracker.total_cost
    session.total_input_tokens = cost_tracker.total_input_tokens
    session.total_output_tokens = cost_tracker.total_output_tokens
    path = session.save()

    if cost_tracker.total_cost > 0:
        ui.console.print(f"\n{cost_tracker.format_summary()}")

    ui.console.print(f"[dim]Session saved: {session.id}[/dim]")


def chat_command(
    model: str = typer.Option(None, "--model", "-m", help="Model to use (e.g., ollama/llama3, gpt-4o)"),
    resume: str = typer.Option(None, "--resume", "-r", help="Resume a saved session by ID"),
    trust: bool = typer.Option(False, "--trust", help="Trust mode: auto-approve all tool calls"),
    deny: bool = typer.Option(False, "--deny", help="Deny mode: block all non-read tool calls"),
) -> None:
    """Start an interactive chat with the agent."""
    mode = "trust" if trust else ("deny" if deny else "ask")
    asyncio.run(_run_chat(model=model, resume=resume, permission_mode=mode))
