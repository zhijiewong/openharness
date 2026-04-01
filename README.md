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

<video src="https://github.com/user-attachments/assets/a9ab2828-4472-4faa-9541-fc66451a8976" controls width="100%"></video>

---

## Quick Start

```bash
npm install -g @zhijiewang/openharness
oh
```

That's it. Just type `oh` to start chatting with your local Ollama model.

```bash
oh                                    # auto-detect Ollama, start chatting
oh --model ollama/qwen2.5:7b         # specific model
oh --model gpt-4o                     # use OpenAI (needs OPENAI_API_KEY)
oh --trust                            # auto-approve all tool calls
```

<!-- ![Demo](assets/demo.gif) -->

## Install

Requires **Node.js 18+**.

```bash
# From npm
npm install -g @zhijiewang/openharness

# From source
git clone https://github.com/zhijiewong/openharness.git
cd openharness
npm install
npm install -g .
oh
```

## Why OpenHarness?

Claude Code is powerful but locked to Anthropic. OpenHarness gives you the same architecture -- React+Ink terminal UI, async generator agent loop, Zod tool schemas, permission gates -- but works with **any LLM**. Local models via Ollama (free, offline, private), or cloud APIs (OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, and any OpenAI-compatible endpoint).

## Tools

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

## Commands

```bash
oh                          # start chatting (default command)
oh --model MODEL            # use a specific model
oh --trust                  # auto-approve all tools
oh --deny                   # block all non-read tools
oh --resume ID              # resume a saved session
oh models                   # list models and pricing
oh tools                    # list tools and risk levels
oh init                     # set up .oh/ for current project
oh sessions                 # list saved sessions
oh rules                    # show project rules
oh --version                # show version
```

## Providers

```bash
# Local (free, no API key)
oh --model ollama/llama3
oh --model ollama/qwen2.5:7b-instruct

# Cloud (set API key as env var)
OPENAI_API_KEY=sk-... oh --model gpt-4o
ANTHROPIC_API_KEY=sk-ant-... oh --model claude-sonnet-4-6
OPENROUTER_API_KEY=sk-or-... oh --model openrouter/deepseek-chat
```

## Project Rules

Create `.oh/RULES.md` in any repo (or run `oh init`):

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
git clone https://github.com/zhijiewong/openharness.git
cd openharness
npm install
npx tsx src/main.tsx              # run in dev mode
npx tsc --noEmit                  # type check
```

### Adding a provider

Create `src/providers/yourprovider.ts` implementing the `Provider` interface, add a case in `src/providers/index.ts`.

### Adding a tool

Create `src/tools/YourTool/index.ts` implementing the `Tool` interface with a Zod input schema, register it in `src/tools.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

This project is not affiliated with Anthropic.
