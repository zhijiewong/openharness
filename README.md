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

Open-source terminal coding agent. Build your own Claude Code with any LLM.

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Node.js 18+](https://img.shields.io/badge/node-18%2B-green)
![TypeScript](https://img.shields.io/badge/typescript-strict-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

---

## Why OpenHarness?

Claude Code is powerful but locked to one provider. OpenHarness gives you the same architecture -- React+Ink terminal UI, async generator agent loop, Zod tool schemas, permission gates -- but works with **any LLM**. Local models via Ollama (free, offline, private), or cloud APIs (OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, and any OpenAI-compatible endpoint).

Single TypeScript process. No Python dependency. No bridge overhead.

## Quick Start

Requires **Node.js 18+**.

```bash
git clone https://github.com/zhijiewong/openharness.git
cd openharness
npm install
npx tsx src/main.tsx chat --model ollama/llama3
```

## What It Does

OpenHarness connects any LLM to a set of tools with permission gates, then runs an agent loop in your terminal using React+Ink for a rich interactive UI.

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

**Harness features:** project rules, cost tracking, session save/resume, project auto-detection.

## Architecture

Built in TypeScript, mirroring Claude Code's patterns:

```
src/
  main.tsx              CLI entry (Commander + React render)
  query.ts              Agent loop (while-true, async generators)
  Tool.ts               Zod-based tool interface
  tools.ts              Tool registry
  types/                Message, events, permissions
  providers/            Ollama, OpenAI, Anthropic, OpenRouter
  tools/                7 tools with Zod input schemas
  components/           React+Ink UI (App, REPL, Spinner, PermissionPrompt)
  harness/              Rules, cost, sessions, project detection
```

The agent loop streams LLM responses via async generators. Tool calls are executed with concurrency control (read-only tools run in parallel, write tools run serially). Permission checks gate every tool call based on risk level.

## Commands

```bash
openharness chat                    # Interactive agent session
openharness chat -m gpt-4o         # Use a specific model
openharness chat --trust            # Auto-approve all tools
openharness chat --deny             # Block all non-read tools
openharness chat --resume ID        # Resume a saved session
openharness models                  # List models and pricing
openharness tools                   # List tools and risk levels
openharness init                    # Set up .oh/ for current project
openharness sessions                # List saved sessions
openharness rules                   # Show project rules
openharness version                 # Show version
```

## Configuration

Set your model via the `--model` flag or environment variables:

```bash
# Local models (free, no API key needed)
openharness chat --model ollama/llama3

# Cloud models (set API key as env var)
OPENAI_API_KEY=sk-... openharness chat --model openai/gpt-4o
ANTHROPIC_API_KEY=sk-ant-... openharness chat --model anthropic/claude-sonnet-4-6

# OpenRouter (300+ models via one key)
OPENROUTER_API_KEY=sk-or-... openharness chat --model openrouter/deepseek/deepseek-chat

# Any OpenAI-compatible endpoint
openharness chat --model deepseek/deepseek-chat
```

## Project Rules

Create `.oh/RULES.md` in any repo (or run `openharness init`):

```markdown
- Always run tests after changes
- Use strict TypeScript
- Never commit to main directly
```

Rules load automatically into every session.

## Tech Stack

| | OpenHarness | Claude Code |
|---|---|---|
| Language | TypeScript (strict) | TypeScript (strict) |
| Runtime | Node.js 18+ | Bun |
| Terminal UI | React + Ink | React + custom Ink fork |
| Tool schemas | Zod | Zod |
| Agent loop | async generators | async generators |
| Providers | Any (5 built-in) | Anthropic only |
| License | MIT | Proprietary |

## Development

```bash
npm install
npx tsc --noEmit            # type check
npx tsx src/main.tsx chat    # run dev
```

### Adding a new provider

Create `src/providers/yourprovider.ts` implementing the `Provider` interface, then add a case in `src/providers/index.ts`.

### Adding a new tool

Create `src/tools/YourTool/index.ts` implementing the `Tool` interface with a Zod input schema, then register it in `src/tools.ts`.

## Python Reference

A complete Python implementation is available under `python/` with its own CLI (`oh`), 61 tests, and the same feature set. It serves as a reference implementation and alternative for Python-first users.

## Contributing

1. Open an issue before larger changes
2. `npm install` and `npx tsc --noEmit` before PRs
3. Keep README in sync with CLI
4. No CLA required

## License

MIT

---

This project is not affiliated with Anthropic.
