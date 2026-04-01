"""Shared Rich rendering utilities for the CLI."""

from __future__ import annotations

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.text import Text

console = Console()

ASCII_BANNER = r"""
        ___
       /   \
      (     )        ___  ___  ___ _  _ _  _   _ ___ _  _ ___ ___ ___
       `~w~`        / _ \| _ \| __| \| | || | /_\ | _ \ \| | __/ __/ __|
       (( ))       | (_) |  _/| _|| .` | __ |/ _ \|   / .` | _|\__ \__ \
        ))((        \___/|_|  |___|_|\_|_||_/_/ \_\_|_\_|\_|___|___/___/
       ((  ))
        `--`                Build your own terminal coding agent with any LLM.
""".strip("\n")


def print_startup_banner(version: str, model: str, permission_mode: str, tools: list[str], extras: list[str] | None = None) -> None:
    """Render the OpenHarness startup banner and session metadata."""
    console.print(Text(ASCII_BANNER, style="bold cyan"))
    console.print(
        Text.assemble(
            ("OpenHarness ", "bold"),
            (f"v{version}", "dim"),
            ("  ", ""),
            (model, "cyan"),
            ("  ", ""),
            (f"({permission_mode} mode)", "dim"),
        )
    )
    console.print(f"[dim]Tools: {', '.join(tools)}[/dim]")
    if extras:
        console.print(f"[dim]Loaded: {', '.join(extras)}[/dim]")
    console.print("[dim]Type 'exit' or Ctrl+C to quit.[/dim]")


def print_assistant(content: str) -> None:
    """Print assistant response with markdown rendering."""
    if content.strip():
        console.print(Markdown(content))


def print_tool_call(tool_name: str, summary: str) -> None:
    """Print a tool call notification."""
    console.print(
        Text.assemble(
            ("  ", ""),
            (tool_name, "bold cyan"),
            (" ", ""),
            (summary[:120], "dim"),
        )
    )


def print_tool_result(output: str, is_error: bool = False) -> None:
    """Print tool execution result."""
    style = "red" if is_error else "dim green"
    # Truncate long output for display
    lines = output.splitlines()
    if len(lines) > 20:
        display = "\n".join(lines[:10] + ["...", f"({len(lines)} lines total)", "..."] + lines[-5:])
    else:
        display = output
    console.print(Text(display, style=style))


def print_cost(input_tokens: int, output_tokens: int, cost: float, model: str) -> None:
    """Print cost update."""
    console.print(
        Text.assemble(
            ("Cost: ", "dim"),
            (f"${cost:.4f}", "bold yellow" if cost > 0 else "dim"),
            (f" ({input_tokens}+{output_tokens} tokens, {model})", "dim"),
        )
    )


def print_error(message: str) -> None:
    """Print an error message."""
    console.print(Text(f"Error: {message}", style="bold red"))


def print_permission_denied(tool_name: str, reason: str) -> None:
    """Print permission denied message."""
    console.print(
        Text.assemble(
            ("Denied: ", "bold red"),
            (tool_name, "cyan"),
            (f" ({reason})", "dim"),
        )
    )


def ask_permission(tool_name: str, description: str) -> bool:
    """Ask user for permission to execute a tool. Returns True if approved."""
    console.print()
    console.print(
        Panel(
            Text.assemble(
                (f"{tool_name}\n", "bold cyan"),
                (description[:500], ""),
            ),
            title="[yellow]Permission Required[/yellow]",
            border_style="yellow",
        )
    )
    try:
        response = console.input("[yellow]Allow? [y/n]: [/yellow]").strip().lower()
        return response in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        return False
