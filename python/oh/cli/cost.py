"""oh cost — view spending dashboard."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.table import Table

from openharness.core.config import DEFAULT_OH_HOME
from openharness.harness.cost import CostTracker

from .ui import console

COST_DIR = DEFAULT_OH_HOME / "costs"


def cost_command(
    today: bool = typer.Option(False, "--today", help="Show today's spending only"),
    budget: float = typer.Option(0, "--budget", help="Set daily budget (USD)"),
) -> None:
    """Show cost dashboard."""
    if budget > 0:
        console.print(f"[yellow]Budget feature will be available in a future version.[/yellow]")
        return

    # Load all cost files
    if not COST_DIR.exists():
        console.print("[dim]No cost data yet. Start a chat session first.[/dim]")
        return

    total_tracker = CostTracker()
    for cost_file in sorted(COST_DIR.glob("*.json")):
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

    if not total_tracker.events:
        console.print("[dim]No cost data yet.[/dim]")
        return

    # Summary
    console.print(f"\n[bold]Cost Dashboard[/bold]\n")
    console.print(total_tracker.format_summary())

    # By provider
    by_prov = total_tracker.by_provider()
    if by_prov:
        console.print("\n[bold]By Provider:[/bold]")
        table = Table()
        table.add_column("Provider", style="cyan")
        table.add_column("Cost", justify="right", style="yellow")
        for prov, cost in sorted(by_prov.items(), key=lambda x: -x[1]):
            table.add_row(prov, f"${cost:.4f}")
        console.print(table)
