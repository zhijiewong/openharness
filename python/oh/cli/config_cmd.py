"""oh config — manage OpenHarness configuration."""

from __future__ import annotations

import typer
from rich.table import Table

from openharness.core.config import AgentConfig, DEFAULT_CONFIG_PATH

from .ui import console

config_app = typer.Typer(help="Manage configuration.")


@config_app.command("show")
def config_show() -> None:
    """Show current configuration."""
    config = AgentConfig.load()
    table = Table(title=f"Configuration ({DEFAULT_CONFIG_PATH})")
    table.add_column("Setting", style="cyan")
    table.add_column("Value")

    table.add_row("provider", config.provider)
    table.add_row("model", config.model)
    table.add_row("permission_mode", config.permission_mode)
    table.add_row("max_cost_per_session", f"${config.max_cost_per_session:.2f}" if config.max_cost_per_session else "unlimited")
    table.add_row("oh_home", str(config.oh_home))
    table.add_row("session_dir", str(config.session_dir))

    if config.providers:
        for name, prov in config.providers.items():
            key_display = f"{'***' + prov.api_key[-4:]}" if prov.api_key else "(not set)"
            table.add_row(f"providers.{name}.api_key", key_display)
            if prov.base_url:
                table.add_row(f"providers.{name}.base_url", prov.base_url)

    console.print(table)


@config_app.command("set")
def config_set(
    key: str = typer.Argument(help="Config key (e.g., provider, model, providers.openai.api_key)"),
    value: str = typer.Argument(help="Value to set"),
) -> None:
    """Set a configuration value."""
    config = AgentConfig.load()

    # Handle nested provider keys
    if key.startswith("providers."):
        parts = key.split(".", 2)
        if len(parts) == 3:
            _, prov_name, field = parts
            from openharness.core.config import ProviderConfig

            if prov_name not in config.providers:
                config.providers[prov_name] = ProviderConfig(name=prov_name)
            prov = config.providers[prov_name]
            if field == "api_key":
                prov.api_key = value
            elif field == "base_url":
                prov.base_url = value
            elif field == "default_model":
                prov.default_model = value
            else:
                prov.extra[field] = value
        else:
            console.print(f"[red]Invalid key: {key}. Use providers.<name>.<field>[/red]")
            return
    elif hasattr(config, key):
        # Handle type conversion
        current = getattr(config, key)
        if isinstance(current, float):
            setattr(config, key, float(value))
        elif isinstance(current, int):
            setattr(config, key, int(value))
        else:
            setattr(config, key, value)
    else:
        console.print(f"[red]Unknown config key: {key}[/red]")
        return

    config.save()
    console.print(f"[green]Set {key} = {value}[/green]")
