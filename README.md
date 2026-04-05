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

AI coding agent in your terminal. Works with any LLM -- free local models or cloud APIs.

[![npm version](https://img.shields.io/npm/v/@zhijiewang/openharness)](https://www.npmjs.com/package/@zhijiewang/openharness) [![npm downloads](https://img.shields.io/npm/dm/@zhijiewang/openharness)](https://www.npmjs.com/package/@zhijiewang/openharness) [![license](https://img.shields.io/npm/l/@zhijiewang/openharness)](LICENSE) ![Node.js 18+](https://img.shields.io/badge/node-18%2B-green) ![TypeScript](https://img.shields.io/badge/typescript-strict-blue) [![GitHub stars](https://img.shields.io/github/stars/zhijiewong/openharness)](https://github.com/zhijiewong/openharness) [![GitHub issues](https://img.shields.io/github/issues-raw/zhijiewong/openharness)](https://github.com/zhijiewong/openharness/issues) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/zhijiewong/openharness/pulls)

---

<video src="https://github.com/user-attachments/assets/ed19a2cc-14d3-4db3-aa5b-3dc07c444498" controls width="100%"></video>

*OpenHarness reading files, running commands, and editing code — powered by a local Ollama model.*

---

## Quick Start

```bash
npm install -g @zhijiewang/openharness
oh
```

That's it. OpenHarness auto-detects Ollama and starts chatting. No API key needed.

```bash
oh init                               # interactive setup wizard (provider + cybergotchi)
oh                                    # auto-detect local model
oh --model ollama/qwen2.5:7b         # specific model
oh --model gpt-4o                     # cloud model (needs OPENAI_API_KEY)
oh --trust                            # auto-approve all tool calls
oh run "fix the tests" --json         # headless mode for CI/CD
```

## Why OpenHarness?

Most AI coding agents are locked to one provider or cost $20+/month. OpenHarness works with any LLM -- run it free with Ollama on your own machine, or connect to any cloud API. Every AI edit is git-committed and reversible with `/undo`.

|  | OpenHarness | Claude Code | Aider | OpenCode |
|---|---|---|---|---|
| Any LLM | Yes (Ollama, OpenAI, Anthropic, OpenRouter, any OpenAI-compatible) | Anthropic only | Yes | Yes |
| Free local models | Ollama native | No | Yes | Yes |
| Tools | 18 with permission gates | 40+ | File-focused | 20+ |
| Git integration | Auto-commit + /undo | Yes | Deep git | Basic |
| Slash commands | 16 built-in | 80+ | Some | Some |
| Headless/CI mode | `oh run --json` | Yes | Yes | Yes |
| Terminal UI | React + Ink | React + Ink | Basic | BubbleTea |
| Language | TypeScript | TypeScript | Python | Go |
| License | MIT | Proprietary | Apache 2.0 | MIT |
| Price | Free (BYOK) | $20+/month | Free (BYOK) | Free (BYOK) |

## Tools (18)

| Tool | Risk | Description |
|------|------|-------------|
| Bash | high | Execute shell commands with live streaming output |
| Read | low | Read files with line ranges |
| ImageRead | low | Read images/PDFs for multimodal analysis |
| Write | medium | Create or overwrite files |
| Edit | medium | Search-and-replace edits |
| Glob | low | Find files by pattern |
| Grep | low | Regex content search |
| LS | low | List directory contents with sizes |
| WebFetch | medium | Fetch URL content (SSRF-protected) |
| WebSearch | medium | Search the web |
| TaskCreate | low | Create structured tasks |
| TaskUpdate | low | Update task status |
| TaskList | low | List all tasks |
| AskUser | low | Ask user a question with options |
| Skill | low | Invoke a skill from .oh/skills/ |
| Agent | medium | Spawn a sub-agent for delegation |
| EnterPlanMode | low | Enter structured planning mode |
| ExitPlanMode | low | Exit planning mode |
| NotebookEdit | medium | Edit Jupyter notebooks |

Low-risk read-only tools auto-approve. Medium and high risk tools require confirmation in `ask` mode. Use `--trust` to skip all prompts.

## Slash Commands (18)

Type these during a chat session:

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation history |
| `/cost` | Show session cost and token usage |
| `/status` | Show model, mode, git branch, MCP servers |
| `/diff` | Show uncommitted git changes |
| `/undo` | Undo last AI commit |
| `/commit [msg]` | Create a git commit |
| `/log` | Show recent git commits |
| `/history [n]` | List recent sessions; `/history search <term>` to search |
| `/files` | List files in context |
| `/model <name>` | Switch model mid-session |
| `/compact` | Compress conversation to free context (smart: truncates old tool results, drops oldest messages, removes orphaned tool results, targets 60% of model context window) |
| `/export` | Export conversation to markdown |
| `/plan` | Enter plan mode |
| `/review` | Review recent code changes |
| `/config` | Show configuration |
| `/memory` | View memories |
| `/cybergotchi` | Feed, pet, rest, status, rename, or reset your companion |

## Permission Modes

Control how aggressively OpenHarness auto-approves tool calls:

| Mode | Flag | Behavior |
|------|------|----------|
| `ask` | `--permission-mode ask` | Prompt for medium/high risk operations (default) |
| `trust` | `--trust` | Auto-approve everything |
| `deny` | `--deny` | Only allow low-risk read-only operations |
| `acceptEdits` | `--permission-mode acceptEdits` | Auto-approve file edits, ask for Bash/WebFetch/Agent |
| `plan` | `--permission-mode plan` | Read-only mode — block all write operations |

Set permanently in `.oh/config.yaml`: `permissionMode: 'acceptEdits'`

## Hooks

Run shell scripts automatically at key session events by adding a `hooks` block to `.oh/config.yaml`:

```yaml
hooks:
  - event: sessionStart
    command: "echo 'Session started' >> ~/.oh/session.log"

  - event: preToolUse
    command: "scripts/check-tool.sh"
    match: Bash   # optional: only trigger for this tool name

  - event: postToolUse
    command: "scripts/after-tool.sh"

  - event: sessionEnd
    command: "scripts/cleanup.sh"
```

**Event types:**
- `sessionStart` — fires once when the session begins
- `preToolUse` — fires before each tool call; **exit code 1 blocks the tool** and returns an error to the model
- `postToolUse` — fires after each tool call completes
- `sessionEnd` — fires when the session ends

**Environment variables** available to hook scripts:

| Variable | Description |
|----------|-------------|
| `OH_EVENT` | Event type (`sessionStart`, `preToolUse`, etc.) |
| `OH_TOOL_NAME` | Name of the tool being called (tool events only) |
| `OH_TOOL_ARGS` | JSON-encoded tool arguments (tool events only) |
| `OH_TOOL_OUTPUT` | JSON-encoded tool output (`postToolUse` only) |

Use `match` to restrict a hook to a specific tool name (e.g., `match: Bash` only triggers for the Bash tool).

## Cybergotchi

OpenHarness ships with a Tamagotchi-style companion that lives in the side panel. It reacts to your session in real time — celebrating streaks, complaining when tools fail, and getting hungry if you ignore it.

**Hatch one:**
```
oh init        # wizard includes cybergotchi setup
/cybergotchi   # or hatch mid-session
```

**Commands:**
```
/cybergotchi feed      # +30 hunger
/cybergotchi pet       # +20 happiness
/cybergotchi rest      # +40 energy
/cybergotchi status    # show needs + lifetime stats
/cybergotchi rename    # give it a new name
/cybergotchi reset     # start over with a new species
```

**Needs** decay over time (hunger fastest, happiness slowest). Feed and pet your gotchi to keep it happy.

**Evolution** — your gotchi evolves based on lifetime milestones:
- Stage 1 (✦ magenta): 10 sessions or 50 commits
- Stage 2 (★ yellow + crown): 100 tasks completed or a 25-tool streak

**18 species** to choose from: duck, cat, owl, penguin, rabbit, turtle, snail, octopus, axolotl, cactus, mushroom, chonk, capybara, goose, and more.

## MCP Servers

Connect any MCP (Model Context Protocol) server by editing `.oh/config.yaml`:

```yaml
provider: anthropic
model: claude-sonnet-4-6
permissionMode: ask
mcpServers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ghp_...
```

MCP tools appear alongside built-in tools. `/status` shows connected servers.

## Git Integration

OpenHarness auto-commits AI edits in git repos:

```
oh: Edit src/app.ts                    # auto-committed with "oh:" prefix
oh: Write tests/app.test.ts
```

- Every AI file change is committed automatically
- `/undo` reverts the last AI commit (only OH commits, never yours)
- `/diff` shows what changed
- Your dirty files are safe — committed separately before AI edits

## Headless Mode

Run a single prompt without interactive UI — perfect for CI/CD:

```bash
oh run "fix the failing tests" --model ollama/llama3 --trust
oh run "add error handling to api.ts" --json    # JSON output
oh run "explain this codebase" --model gpt-4o

# Pipe stdin — prompt from stdin, or prepend context
cat error.log | oh run "what's wrong here?"
git diff | oh run "review these changes"
oh run - < prompt.txt                           # read full prompt from file
oh run "fix this:" < broken.py                  # prepend arg, append stdin
```

Exit code 0 on success, 1 on failure.

## Providers

```bash
# Local (free, no API key needed)
oh --model ollama/llama3
oh --model ollama/qwen2.5:7b

# Cloud
OPENAI_API_KEY=sk-... oh --model gpt-4o
ANTHROPIC_API_KEY=sk-ant-... oh --model claude-sonnet-4-6
OPENROUTER_API_KEY=sk-or-... oh --model openrouter/meta-llama/llama-3-70b

# llama.cpp / GGUF
oh --model llamacpp/my-model

# LM Studio
oh --model lmstudio/my-model
```

### llama.cpp / GGUF (local, no Ollama needed)

For direct GGUF support via `llama-server`, without the overhead of Ollama. Often faster for large models.

**Prerequisites:**
- Install llama.cpp: `brew install llama.cpp` or download from [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
- Download a GGUF model (e.g., from [HuggingFace](https://huggingface.co))

**Start llama-server:**
```bash
llama-server --model ./your-model.gguf --port 8080 --alias my-model
```

**Configure via `oh init`:**
- Run `oh init` and select "llama.cpp / GGUF" when prompted

**Or configure manually** in `.oh/config.yaml`:
```yaml
provider: llamacpp
model: my-model
baseUrl: http://localhost:8080
permissionMode: ask
```

**Run:**
```bash
oh
oh --model llamacpp/my-model
oh models                    # list available models
```

## Project Rules

Create `.oh/RULES.md` in any repo (or run `oh init`):

```markdown
- Always run tests after changes
- Use strict TypeScript
- Never commit to main directly
```

Rules load automatically into every session.

## Install

Requires **Node.js 18+**.

```bash
# From npm
npm install -g @zhijiewang/openharness

# From source
git clone https://github.com/zhijiewong/openharness.git
cd openharness
npm install && npm install -g .
```

## Development

```bash
npm install
npx tsx src/main.tsx              # run in dev mode
npx tsc --noEmit                  # type check
npm test                          # run tests
```

### Adding a tool

Create `src/tools/YourTool/index.ts` implementing the `Tool` interface with a Zod input schema, register it in `src/tools.ts`.

### Adding a provider

Create `src/providers/yourprovider.ts` implementing the `Provider` interface, add a case in `src/providers/index.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

Join the OpenHarness community to get help, share your workflows, and discuss the future of AI coding agents!

| Platform | Details & Links |
| :--- | :--- |
| 🟣 **Discord** | [**Join our Discord Server**](https://discord.gg/ezVrqy3qu) to chat with developers and get real-time support. |
| 🔵 **Feishu / Lark** | Scan the QR code below to collaborate with the community:<br><br><img src="https://github.com/user-attachments/assets/54ade077-22ad-45d2-b38a-623464677d53" width="160" alt="Feishu Group QR Code"> |
| 🟢 **WeChat** | Scan the QR code below to join our WeChat group:<br><br><img src="https://github.com/user-attachments/assets/adcf291a-9ffe-4738-8608-f46a21e18db0" width="160" alt="WeChat Group QR Code"> |

## License

MIT

