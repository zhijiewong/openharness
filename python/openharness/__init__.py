"""
openHarness Python SDK — drive the `oh` CLI from Python.

Quick start::

    import asyncio
    from openharness import query, TextDelta

    async def main() -> None:
        async for event in query("What is 2+2?", model="ollama/llama3", max_turns=1):
            if isinstance(event, TextDelta):
                print(event.content, end="")

    asyncio.run(main())
"""

from .events import (
    CostUpdate,
    ErrorEvent,
    Event,
    TextDelta,
    ToolEnd,
    ToolStart,
    TurnComplete,
    parse_event,
)
from .exceptions import OhBinaryNotFoundError, OpenHarnessError
from .query import query

__version__ = "0.1.0"

__all__ = [
    "CostUpdate",
    "ErrorEvent",
    "Event",
    "OhBinaryNotFoundError",
    "OpenHarnessError",
    "TextDelta",
    "ToolEnd",
    "ToolStart",
    "TurnComplete",
    "__version__",
    "parse_event",
    "query",
]
