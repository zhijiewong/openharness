# Changelog — openharness (Python SDK)

This package follows its own SemVer track, independent of the `@zhijiewang/openharness` npm package.

## 0.2.0 — 2026-04-19

### Added
- `OpenHarnessClient` class for long-lived multi-turn conversations. Use as an async context manager; `send(prompt)` returns an async iterator of typed events. Mirrors Claude Code's `ClaudeSDKClient`.
- Concurrent `send()` calls on the same client are serialized via an `asyncio.Lock`.
- `close()` is idempotent; sends a `{command: "exit"}` graceful shutdown sentinel, then falls back to SIGTERM → SIGKILL on timeout.
- `interrupt()` method sends SIGINT to the active subprocess (SIGBREAK on Windows).

### CLI dependency (npm side)
Requires `@zhijiewang/openharness` v2.15.0+ which adds the `oh session` command. Older CLI versions cannot start a stateful session and will error with "unknown command: session".

## 0.1.0 — 2026-04-19

### Added
- Initial release. `query(prompt, **options)` async generator that spawns the `oh` CLI and streams typed events.
- Event dataclasses: `TextDelta`, `ToolStart`, `ToolEnd`, `ErrorEvent`, `CostUpdate`, `TurnComplete`, `UnknownEvent`.
- Exceptions: `OhBinaryNotFoundError`, `OpenHarnessError`.
- Binary discovery via `OH_BINARY` env var (first choice) or `shutil.which("oh")` on PATH.
- Zero runtime dependencies; stdlib async only.
- Typed package (`py.typed` marker); mypy-strict clean.
