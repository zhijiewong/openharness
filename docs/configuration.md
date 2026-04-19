---
layout: default
title: Configuration
---

# Configuration

OpenHarness uses a 3-layer config hierarchy:

1. **Global**: `~/.oh/config.yaml` — defaults for all projects
2. **Project**: `.oh/config.yaml` — project-specific settings
3. **Local**: `.oh/config.local.yaml` — personal overrides (gitignored)

Later layers override earlier ones.

## Model router

Route different parts of your conversation to different models automatically. Configure distinct models per tier in `.oh/config.yaml`:

```yaml
provider: anthropic
model: claude-sonnet-4-6
modelRouter:
  fast: ollama/qwen2.5:7b         # exploration, tool dispatching
  balanced: gpt-4o-mini           # general turns
  powerful: claude-opus-4-7       # final responses, code-review sub-agents
```

All three fields are optional. When a tier is unset, it falls back to the top-level `model:`. When the whole `modelRouter:` block is unset, no routing happens — every turn uses `model:`.

### Heuristics

- **Context pressure > 80%** → `fast` (minimize input-token cost)
- **Sub-agent role** in `code-reviewer`, `evaluator`, `architect`, `security-auditor` → `powerful`
- **Early exploration** (turn 1–2, previous turn had tool calls) → `fast`
- **Tool-heavy turn** (≥3 tool calls on previous turn) → `fast`
- **Final response** (previous turn had no tool calls, turn > 1) → `powerful`
- **Otherwise** → `balanced`

### `/router` slash command

Inspect the current router state and the last selection for your session:

```
> /router
Model router:
  fast       ollama/qwen2.5:7b
  balanced   gpt-4o-mini
  powerful   claude-opus-4-7

Last selection: balanced — "default"
```

When unconfigured: `Router: off (single model: claude-sonnet-4-6)`.

### Notes

- Context-pressure routing requires the provider to implement `estimateTokens` and a known `contextWindow` on the model. Providers without tokenization still get all other heuristics.
- Config reloads at the start of each user turn — edits to `.oh/config.yaml` take effect on the next prompt submission.
- Sub-agents spawned via the `Agent` tool inherit the router's decisions based on their `role` (e.g. a `code-reviewer` agent routes to `powerful` automatically).

## Full Config Reference

```yaml
# Provider and model
provider: ollama          # ollama, openai, anthropic, openrouter, llamacpp, lmstudio
model: llama3             # model identifier
apiKey: sk-...            # API key (or use environment variable)
baseUrl: http://localhost:11434  # custom base URL

# Behavior
permissionMode: ask       # ask, trust, deny, acceptEdits, plan, auto, bypassPermissions
theme: dark               # dark or light

# Verification loops — auto-lint after file edits
verification:
  enabled: true           # default: true (auto-detect)
  mode: warn              # warn (append to output) or block (mark as error)
  rules:
    - extensions: [".ts", ".tsx"]
      lint: "npx tsc --noEmit 2>&1 | head -20"
      timeout: 15000
    - extensions: [".py"]
      lint: "ruff check {file} 2>&1 | head -10"

# Multi-model router — use different models per task type
modelRouter:
  fast: ollama/qwen2.5:7b        # exploration, search
  balanced: gpt-4o-mini           # general use
  powerful: claude-sonnet-4-6     # code review, final output

# Memory
memory:
  consolidateOnExit: true  # prune stale memories on exit

# Hooks — shell scripts at session events
hooks:
  - event: sessionStart
    command: "echo 'Started' >> ~/.oh/log"
  - event: preToolUse
    command: "scripts/check.sh"
    match: Bash
  - event: postToolUse
    command: "scripts/after.sh"
  - event: sessionEnd
    command: "scripts/cleanup.sh"

# Tool permissions
toolPermissions:
  - tool: "Bash"
    action: ask
    pattern: "^rm .*"
  - tool: "Read"
    action: allow

# MCP servers
mcpServers:
  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ghp_...

# Remote server security
remote:
  tokens: ["sk-my-secret-token"]
  rateLimit: 60            # requests/minute per IP
  allowedTools: ["Read", "Glob", "Grep"]  # tool whitelist

# Telemetry (opt-in, default off)
telemetry:
  enabled: false

# Status bar
statusLineFormat: "{model} {tokens} {cost}"
```
