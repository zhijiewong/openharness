# OpenHarness

**OpenHarness** is an open-source Python agent harness for building a terminal coding assistant with the model provider you choose.

Build your own terminal coding agent with any LLM.

It ships with:
- a CLI chat experience via `oh`
- tool calling with permission gates
- local and cloud provider support
- project rules, skills, memory, and session persistence

OpenHarness is currently **alpha** (`0.1.0`). The core loop is in place and usable, but the project is still tightening its CLI surface and documentation.

The project is Python-first today, with a working Node.js/TypeScript CLI frontend built on top of the Python core over stdio.

## Why This Project

If you want a terminal coding-agent workflow with:
- local models through Ollama
- OpenAI, Anthropic, OpenRouter, or OpenAI-compatible APIs
- a Python codebase you can modify
- a lightweight agent harness instead of a large framework

that is the space OpenHarness is aiming for.

## What Works Today

Implemented in this repo today:
- `oh chat` interactive agent loop
- `oh-ts` TypeScript CLI for core bridge-backed workflows
- providers for Ollama, OpenAI, Anthropic, OpenRouter, and OpenAI-compatible backends
- built-in tools for reading files, editing files, writing files, shell commands, glob, grep, and web fetch
- permission modes: `ask`, `trust`, `deny`
- project rules from `.oh/RULES.md` and `.oh/rules/*.md`
- built-in and local markdown skills
- session persistence and cost tracking
- project auto-detection for language/framework/test command hints

## Installation

Base install:

```bash
pip install openharness
```

If you want cloud providers, install the optional extras you need:

```bash
pip install "openharness[openai]"
pip install "openharness[anthropic]"
pip install "openharness[all]"
```

Development install:

```bash
git clone https://github.com/zhijiewong/openharness.git
cd openharness
pip install -e ".[dev]"
```

TypeScript CLI workspace:

```bash
npm.cmd install
npm.cmd run build:cli
```

## Quick Start

### 1. Initialize a project

```bash
oh init
```

This creates `.oh/RULES.md` and `.oh/skills/` in the current project, and also creates `~/.oh/config.yaml` if it does not exist yet.

### 2. Choose a provider

For local use with Ollama:

```bash
oh config set provider ollama
oh config set model llama3
```

For OpenAI:

```bash
oh config set provider openai
oh config set model gpt-4o-mini
oh config set providers.openai.api_key sk-...
```

For Anthropic:

```bash
oh config set provider anthropic
oh config set model claude-3-5-sonnet-latest
oh config set providers.anthropic.api_key sk-ant-...
```

For OpenRouter:

```bash
oh config set provider openrouter
oh config set model openai/gpt-4o-mini
oh config set providers.openrouter.api_key sk-or-...
```

For an OpenAI-compatible endpoint:

```bash
oh config set provider deepseek
oh config set model deepseek-chat
oh config set providers.deepseek.base_url https://api.deepseek.com
oh config set providers.deepseek.api_key <your-key>
```

### 3. Start chatting

```bash
oh chat
```

Or override the model directly for one session:

```bash
oh chat --model ollama/llama3
oh chat --model openai/gpt-4o-mini
```

TypeScript CLI:

```bash
npm.cmd run dev:cli -- version
npm.cmd run dev:cli -- chat "summarize this repo" --permission-mode deny
```

## CLI Commands

Current commands implemented in `0.1.0`:

| Command | Description |
|---|---|
| `oh chat` | Start an interactive coding-agent session |
| `oh init` | Initialize `.oh/` for the current project |
| `oh config show` | Show current configuration |
| `oh config set <key> <value>` | Update configuration |
| `oh models` | List available models and pricing hints |
| `oh tools` | List available tools and risk levels |
| `oh rules` | Show discovered rules files |
| `oh rules --init` | Create `.oh/RULES.md` |
| `oh skills` | List built-in and local skills |
| `oh memory` | View stored memories |
| `oh memory --search <term>` | Search memories |
| `oh cost` | Show cost summary |
| `oh sessions` | List saved sessions |
| `oh version` | Print the installed version |

Node.js/TypeScript CLI commands currently available through the Python bridge:

| Command | Description |
|---|---|
| `oh-ts version` | Show OpenHarness version |
| `oh-ts chat [prompt]` | Run a bridged chat turn or start interactive TS chat |
| `oh-ts config show` | Show config |
| `oh-ts config set <key> <value>` | Update config |
| `oh-ts sessions` | List sessions |
| `oh-ts cost` | Show cost summary |
| `oh-ts tools` | List tools |
| `oh-ts models` | List models |
| `oh-ts rules` | List rules |
| `oh-ts skills` | List skills |
| `oh-ts memory` | List/search memories |
| `oh-ts init` | Initialize project files |

### Useful chat flags

```bash
oh chat --resume <session-id>
oh chat --trust
oh chat --deny
```

Permission behavior:
- `ask`: prompt before non-trivial tool execution
- `trust`: auto-approve all tool calls
- `deny`: allow only low-risk read-only actions

## Built-In Tools

| Tool | Risk | Purpose |
|---|---|---|
| `Read` | low | Read file contents |
| `Edit` | medium | Apply targeted edits to existing files |
| `Write` | medium | Create or overwrite files |
| `Bash` | high | Run shell commands in the working directory |
| `Glob` | low | Find files by pattern |
| `Grep` | low | Search file contents |
| `WebFetch` | medium | Fetch remote URL content |

In `ask` mode, low-risk read-only tools are auto-approved, while riskier actions require confirmation.

## Configuration

Global config lives at:

```text
~/.oh/config.yaml
```

You can inspect it with:

```bash
oh config show
```

Common settings:

```bash
oh config set provider ollama
oh config set model llama3
oh config set permission_mode ask
oh config set max_cost_per_session 1.00
```

Provider-specific keys use the `providers.<name>.<field>` format:

```bash
oh config set providers.openai.api_key sk-...
oh config set providers.openai.base_url https://api.openai.com/v1
oh config set providers.openrouter.api_key sk-or-...
```

## Project Layout

After `oh init`, a project typically uses:

```text
.oh/
  RULES.md
  skills/
```

Additional directories may be used by the harness at runtime, especially under `~/.oh/`, including session, memory, and cost data.

## Rules

Rules are loaded in this order:
1. `~/.oh/global-rules/*.md`
2. `.oh/RULES.md`
3. `.oh/rules/*.md`

Example `.oh/RULES.md`:

```md
# Project Rules

- Run tests after code changes
- Use type hints in Python code
- Prefer small, reviewable patches
```

## Skills

Skills are markdown files with YAML frontmatter. OpenHarness loads them from:
- built-in skills in `data/skills/`
- global skills in `~/.oh/skills/`
- project skills in `.oh/skills/`

Built-in skills currently included:
- `commit`
- `debug`
- `review`
- `tdd`

List them with:

```bash
oh skills
```

## Architecture

OpenHarness is organized into four main layers:

```text
CLI (`oh`)
  Interactive terminal experience and commands

Agent engine (`openharness.agent`)
  Chat loop, tool orchestration, permission checks, routing, sub-agents

Providers and tools (`openharness.providers`, `openharness.tools`)
  LLM backends plus executable tool implementations

Core and harness utilities (`openharness.core`, `openharness.harness`)
  Config, sessions, events, rules, memory, hooks, onboarding, cost tracking
```

This makes it possible to use pieces of the project separately if you want to build your own interface or workflow on top.

## TypeScript CLI Direction

OpenHarness includes a working Node.js/TypeScript CLI under `packages/cli/`.

Current intent:
- Python stays the core harness runtime
- TypeScript becomes a first-class CLI frontend
- the two communicate over a small stdio bridge

See `docs/2026-04-01-typescript-cli-plan.md` for the rollout plan.

Current local workflow:

```bash
npm.cmd install
npm.cmd run dev:cli -- version
npm.cmd run dev:cli -- config show
npm.cmd run dev:cli -- chat "summarize this repo" --permission-mode deny
npm.cmd run dev:cli -- chat --permission-mode deny
npm.cmd run dev:cli -- chat --resume <session-id> --permission-mode deny
npm.cmd run dev:cli -- chat --permission-mode ask
```

Current boundary:
- `oh-ts chat` supports one-shot and interactive bridge-backed chat
- `oh-ts chat --resume <session-id>` can continue an existing saved session
- `oh-ts chat --permission-mode ask` now prompts for approval on tool use
- the Python `oh chat` CLI is still the richer interactive experience today

## Development

Run tests:

```bash
pytest
```

Project layout:

```text
oh/              CLI entrypoints
openharness/     core framework code
data/            built-in prompts, model data, and skills
tests/           test suite
docs/            design notes and specs
```

## Contributing

Contributions are welcome. A good way to start is:

1. Open an issue or discussion for larger changes.
2. Install the project in editable mode.
3. Run `pytest` before sending a PR.
4. Keep README and command docs aligned with the implemented CLI.

## License

MIT. See [LICENSE](LICENSE).

## Inspiration

OpenHarness explores terminal-agent workflows as an open-source Python project that works with many model providers.

This project is not affiliated with Anthropic.
