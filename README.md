# OpenHarness

```
        ___
       /   \
      (     )        ___  ___  ___ _  _ _  _   _ ___ _  _ ___ ___ ___
       `~w~`        / _ \| _ \| __| \| | || | /_\ | _ \ \| | __/ __/ __|
       (( ))       | (_) |  _/| _|| .` | __ |/ _ \|   / .` | _|\__ \__ \
        ))((        \___/|_|  |___|_|\_|_||_/_/ \_\_|_\_|\_|___|___/___/
       ((  ))
        `--`
```

Build your own terminal coding agent with any LLM.

---

## Quick Start

```bash
pip install openharness
oh init
oh chat --model ollama/llama3
```

## What It Does

OpenHarness is an open-source Python agent harness. It connects any LLM to a set of tools (file read/edit/write, shell, search, web fetch) with permission gates, then runs an agent loop in your terminal.

**Providers:** Ollama, OpenAI, Anthropic, OpenRouter, any OpenAI-compatible API

**Tools:**

| Tool | Risk | Description |
|------|------|-------------|
| Read | low | Read files with line ranges |
| Edit | medium | Search-and-replace edits |
| Write | medium | Create or overwrite files |
| Bash | high | Shell commands with timeout |
| Glob | low | Find files by pattern |
| Grep | low | Regex content search |
| WebFetch | medium | Fetch URL content |

Low-risk tools auto-approve. Medium and high risk require confirmation in `ask` mode.

**Harness features:** project rules, reusable skills, lifecycle hooks, persistent memory, cost tracking, session save/resume, project auto-detection.

## Installation

```bash
pip install openharness                  # base
pip install "openharness[openai]"        # + OpenAI SDK
pip install "openharness[anthropic]"     # + Anthropic SDK
pip install "openharness[all]"           # everything
```

Development:

```bash
git clone https://github.com/zhijiewong/openharness.git
cd openharness
pip install -e ".[dev]"
```

## Configuration

```bash
# Local models (free)
oh config set provider ollama
oh config set model llama3

# Cloud models
oh config set provider openai
oh config set model gpt-4o
oh config set providers.openai.api_key sk-...

# Permission mode: ask (default), trust, deny
oh config set permission_mode ask

# Budget ceiling
oh config set max_cost_per_session 5.00
```

## Commands

| Command | Description |
|---------|-------------|
| `oh chat` | Interactive agent session |
| `oh chat -m MODEL` | Use a specific model |
| `oh chat --trust` | Auto-approve all tools |
| `oh chat --resume ID` | Resume a saved session |
| `oh init` | Set up `.oh/` for current project |
| `oh models` | List models and pricing |
| `oh tools` | List tools and risk levels |
| `oh cost` | Spending summary |
| `oh sessions` | Saved sessions |
| `oh config show` | Current config |
| `oh config set K V` | Update config |
| `oh rules` | Project rules |
| `oh skills` | Available skills |
| `oh memory` | Stored memories |

## Project Rules

Create `.oh/RULES.md` in any repo (or run `oh init`):

```markdown
- Always run tests after changes
- Use type hints in Python
- Never commit to main directly
```

Rules load automatically into every session. Load order: `~/.oh/global-rules/*.md` then `.oh/RULES.md` then `.oh/rules/*.md`.

## Architecture

```
oh/cli               CLI commands (chat, config, cost, etc.)
openharness/agent    Agent loop, permissions, routing, sub-agents, context
openharness/providers  Ollama, OpenAI, Anthropic, OpenRouter, OpenAI-compat
openharness/tools    Read, Edit, Write, Bash, Glob, Grep, WebFetch
openharness/harness  Rules, skills, hooks, memory, cost, onboarding
openharness/core     Types, config, session, events
openharness/mcp      MCP client for external tool servers
packages/cli         TypeScript CLI frontend (bridges to Python core via stdio)
```

## TypeScript CLI

A Node.js/TypeScript frontend is available under `packages/cli/`. It bridges to the Python core over stdio.

```bash
npm install && npm run build:cli
oh-ts chat "explain this codebase" --permission-mode ask
oh-ts models
oh-ts config show
```

## Contributing

1. Open an issue for larger changes
2. `pip install -e ".[dev]"` and `pytest` before PRs
3. Keep CLI and docs in sync

## License

MIT

---

This project is not affiliated with Anthropic.
