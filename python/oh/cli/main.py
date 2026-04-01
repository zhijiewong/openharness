"""oh — OpenHarness CLI entry point."""

import typer

from .chat import chat_command
from .config_cmd import config_app
from .cost import cost_command
from .sessions import sessions_command

app = typer.Typer(
    name="oh",
    help="OpenHarness — open-source agent harness for any LLM.",
    no_args_is_help=True,
    add_completion=False,
)

# Core commands
app.command("chat", help="Start an interactive chat with the agent.")(chat_command)
app.command("cost", help="Show cost dashboard.")(cost_command)
app.command("sessions", help="List saved sessions.")(sessions_command)

# Sub-apps
app.add_typer(config_app, name="config", help="Manage configuration.")


@app.command("init")
def init_project() -> None:
    """Initialize OpenHarness for the current project."""
    from pathlib import Path

    from openharness.core.config import AgentConfig, DEFAULT_CONFIG_PATH
    from openharness.harness.rules import RulesLoader

    from .ui import console

    cwd = Path.cwd()
    oh_dir = cwd / ".oh"
    created: list[str] = []

    # Create .oh directory
    oh_dir.mkdir(exist_ok=True)

    # Create RULES.md
    loader = RulesLoader(project_path=cwd)
    rules_file = oh_dir / "RULES.md"
    if not rules_file.exists():
        loader.create_rules_file()
        created.append(".oh/RULES.md")

    # Create skills directory
    skills_dir = oh_dir / "skills"
    skills_dir.mkdir(exist_ok=True)
    if not list(skills_dir.glob("*.md")):
        created.append(".oh/skills/")

    # Create global config if not exists
    if not DEFAULT_CONFIG_PATH.exists():
        config = AgentConfig()
        config.save()
        created.append(str(DEFAULT_CONFIG_PATH))

    # Detect project
    try:
        from openharness.harness.onboarding import ProjectDetector

        ctx = ProjectDetector().detect(cwd)
        console.print(f"[bold]Project detected:[/bold] {ctx.language}", end="")
        if ctx.framework:
            console.print(f" ({ctx.framework})", end="")
        console.print()
        if ctx.has_git:
            console.print(f"[dim]Git branch: {ctx.git_branch}[/dim]")
    except Exception:
        pass

    if created:
        console.print(f"\n[green]Created:[/green]")
        for f in created:
            console.print(f"  {f}")
    else:
        console.print("[dim]Project already initialized.[/dim]")

    console.print(f"\n[dim]Run 'oh chat' to start coding.[/dim]")


@app.command()
def version() -> None:
    """Show the OpenHarness version."""
    from openharness import __version__

    typer.echo(f"OpenHarness v{__version__}")


@app.command()
def models(
    provider: str = typer.Option(None, "--provider", "-p", help="Filter by provider"),
) -> None:
    """List available models."""
    from rich.table import Table

    from openharness.core.config import ProviderConfig
    from openharness.providers.ollama import OllamaProvider

    from .ui import console

    table = Table(title="Available Models")
    table.add_column("Model", style="cyan")
    table.add_column("Provider", style="green")
    table.add_column("Context", justify="right")
    table.add_column("Tools", justify="center")
    table.add_column("Cost (in/out per 1M)", justify="right")

    # List Ollama models (local)
    if not provider or provider == "ollama":
        ollama = OllamaProvider(ProviderConfig(name="ollama"))
        for m in ollama.list_models():
            table.add_row(
                m.id,
                m.provider,
                str(m.context_window),
                "yes" if m.supports_tools else "no",
                "free",
            )

    # List cloud model pricing from registry
    if not provider or provider != "ollama":
        from openharness.harness.cost import MODEL_PRICING

        for model_name, (inp, out) in sorted(MODEL_PRICING.items()):
            if inp == 0:
                continue  # Skip free/local models
            if provider and provider not in model_name:
                continue
            table.add_row(
                model_name,
                _guess_provider(model_name),
                "-",
                "yes",
                f"${inp:.2f} / ${out:.2f}",
            )

    if table.row_count == 0:
        console.print("[yellow]No models found. Is Ollama running? (ollama serve)[/yellow]")
    else:
        console.print(table)


@app.command()
def tools() -> None:
    """List available tools."""
    from rich.table import Table

    from .ui import console

    # Import all tools
    from openharness.tools.file_read import FileReadTool
    from openharness.tools.bash import BashTool

    all_tools = [FileReadTool(), BashTool()]

    # Try importing Phase 2 tools
    try:
        from openharness.tools.file_edit import FileEditTool
        from openharness.tools.file_write import FileWriteTool
        from openharness.tools.glob_tool import GlobTool
        from openharness.tools.grep import GrepTool
        from openharness.tools.web_fetch import WebFetchTool

        all_tools.extend([FileEditTool(), FileWriteTool(), GlobTool(), GrepTool(), WebFetchTool()])
    except ImportError:
        pass

    table = Table(title="Available Tools")
    table.add_column("Tool", style="cyan")
    table.add_column("Risk", justify="center")
    table.add_column("Read-Only", justify="center")
    table.add_column("Description")

    for tool in all_tools:
        risk_style = {"low": "green", "medium": "yellow", "high": "red"}[tool.risk_level.value]
        table.add_row(
            tool.name,
            f"[{risk_style}]{tool.risk_level.value}[/{risk_style}]",
            "yes" if tool.is_read_only({}) else "no",
            tool.description[:80],
        )

    console.print(table)


@app.command()
def rules(
    init: bool = typer.Option(False, "--init", help="Create .oh/RULES.md for this project"),
) -> None:
    """Show loaded project rules."""
    from pathlib import Path
    from openharness.harness.rules import RulesLoader
    from .ui import console

    loader = RulesLoader(project_path=Path.cwd())

    if init:
        path = loader.create_rules_file()
        console.print(f"[green]Created {path}[/green]")
        return

    files = loader.rules_files
    if not files:
        console.print("[dim]No rules loaded. Use --init to create .oh/RULES.md[/dim]")
        return

    console.print(f"[bold]Rules ({len(files)} files):[/bold]")
    for f in files:
        console.print(f"  [cyan]{f}[/cyan]")

    prompt = loader.load_as_prompt()
    if prompt:
        console.print(f"\n[dim]{len(prompt)} chars will be injected into system prompt[/dim]")


@app.command()
def skills() -> None:
    """List available skills."""
    from pathlib import Path
    from rich.table import Table
    from openharness.harness.skills import SkillRegistry
    from .ui import console

    registry = SkillRegistry()
    count = registry.load_all(project_path=Path.cwd())

    if count == 0:
        console.print("[dim]No skills found. Add .md files to .oh/skills/ or ~/.oh/skills/[/dim]")
        return

    table = Table(title=f"Skills ({count})")
    table.add_column("Name", style="cyan")
    table.add_column("Source")
    table.add_column("Context")
    table.add_column("Description")

    for skill in registry.list_all():
        table.add_row(skill.name, skill.source, skill.context, skill.description[:60])

    console.print(table)


@app.command()
def memory(
    search: str = typer.Option(None, "--search", "-s", help="Search memories by keyword"),
) -> None:
    """View and search memories."""
    from rich.table import Table
    from openharness.core.config import DEFAULT_OH_HOME
    from openharness.harness.memory import MemorySystem
    from .ui import console

    mem = MemorySystem(DEFAULT_OH_HOME / "memory")
    memories = mem.search(search) if search else mem.load_all()

    if not memories:
        console.print("[dim]No memories stored yet.[/dim]")
        return

    table = Table(title=f"Memories ({len(memories)})")
    table.add_column("ID", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Title")
    table.add_column("Description")

    for m in memories:
        table.add_row(m.id, m.type, m.title[:30], m.description[:50])

    console.print(table)


def _guess_provider(model_name: str) -> str:
    if "gpt" in model_name or model_name.startswith("o3"):
        return "openai"
    if "claude" in model_name:
        return "anthropic"
    if "deepseek" in model_name:
        return "deepseek"
    if "qwen" in model_name:
        return "qwen"
    return "unknown"


if __name__ == "__main__":
    app()
