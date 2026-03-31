# Contributing to OpenHarness

Thanks for your interest in contributing.

## Getting Started

```bash
git clone https://github.com/zhijiewong/openharness.git
cd openharness
pip install -e ".[dev]"
```

## Running Tests

```bash
pytest
```

For the TypeScript CLI:

```bash
cd packages/cli
npx tsc --noEmit
npm test
```

## Making Changes

1. Open an issue or discussion before starting large changes.
2. Create a branch from `main`.
3. Write tests for new functionality.
4. Run `pytest` and ensure all tests pass before submitting a PR.
5. Keep the README and CLI help text in sync with code changes.

## Adding a New Provider

1. Create `openharness/providers/yourprovider.py` implementing `BaseProvider`.
2. Implement `complete()`, `stream()`, `list_models()`, and `health_check()`.
3. Add a branch in `oh/cli/chat.py:_build_provider()` for your provider name.
4. Add model pricing to `openharness/harness/cost.py:MODEL_PRICING`.
5. Add a test in `tests/test_providers/`.

## Adding a New Tool

1. Create `openharness/tools/yourtool.py` implementing `BaseTool`.
2. Set `name`, `description`, `parameters_schema`, `risk_level`.
3. Implement `execute()` and optionally `is_read_only()`, `is_concurrency_safe()`.
4. Register it in `oh/cli/chat.py:_build_tools()`.
5. Add a test in `tests/test_tools/`.

## Code Style

- Python 3.11+ with type hints.
- Use `from __future__ import annotations` in all files.
- Frozen dataclasses for value types.
- No CLA required.

## Reporting Issues

Open an issue on GitHub with:
- What you expected vs what happened
- Steps to reproduce
- Python version and OS
