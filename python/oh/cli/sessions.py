"""oh sessions — list and manage saved sessions."""

from __future__ import annotations

import typer
from rich.table import Table

from openharness.core.session import Session

from .ui import console


def sessions_command(
    resume: str = typer.Option(None, "--resume", "-r", help="Resume a session by ID"),
) -> None:
    """List saved sessions."""
    if resume:
        # Delegate to chat with --resume
        console.print(f"[dim]Use: oh chat --resume {resume}[/dim]")
        return

    sessions = Session.list_all()
    if not sessions:
        console.print("[dim]No saved sessions yet.[/dim]")
        return

    table = Table(title="Saved Sessions")
    table.add_column("ID", style="cyan")
    table.add_column("Model", style="green")
    table.add_column("Messages", justify="right")
    table.add_column("Cost", justify="right", style="yellow")
    table.add_column("Updated", style="dim")

    for s in sessions[:20]:
        cost = f"${s['cost']:.4f}" if s.get("cost") else "-"
        table.add_row(
            s["id"],
            s.get("model", "-"),
            str(s.get("messages", 0)),
            cost,
            s.get("updated_at", "")[:19],
        )

    console.print(table)
    console.print(f"\n[dim]Resume: oh chat --resume <ID>[/dim]")
