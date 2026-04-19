# Changelog — openharness (Python SDK)

This package follows its own SemVer track, independent of the `@zhijiewang/openharness` npm package.

## 0.1.0 — 2026-04-19

### Added
- Initial release. `query(prompt, **options)` async generator that spawns the `oh` CLI and streams typed events.
- Event dataclasses: `TextDelta`, `ToolStart`, `ToolEnd`, `ErrorEvent`, `CostUpdate`, `TurnComplete`, `UnknownEvent`.
- Exceptions: `OhBinaryNotFoundError`, `OpenHarnessError`.
- Binary discovery via `OH_BINARY` env var (first choice) or `shutil.which("oh")` on PATH.
- Zero runtime dependencies; stdlib async only.
- Typed package (`py.typed` marker); mypy-strict clean.
