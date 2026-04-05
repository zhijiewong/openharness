# v0.5.0 Features Design Spec

**Date:** 2026-04-05
**Scope:** README docs, session resume/fork, extended thinking, MCP improvements

---

## 1. README Documentation Updates

**Goal:** Document new v0.5.0 features and add provider usage examples (closes #8).

### Permission Modes Section

Add after the Quick Start section. Table of all 5 modes:

| Mode | Behavior |
|------|----------|
| `trust` | Auto-approve everything |
| `ask` | Prompt for medium/high risk operations (default) |
| `deny` | Only allow low-risk read-only operations |
| `acceptEdits` | Auto-approve file operations, ask for Bash/WebFetch/Agent |
| `plan` | Read-only mode — block all write operations |

Usage: `oh --permission-mode acceptEdits` or set in `.oh/config.yaml`.

### Hooks Section

New section with config example showing all 4 event types, explanation of preToolUse blocking (exit code 1), environment variables (`OH_EVENT`, `OH_TOOL_NAME`, `OH_TOOL_ARGS`, `OH_TOOL_OUTPUT`).

### /compact Update

Update the existing `/compact` entry to mention smart compression: truncates old tool results first, drops oldest messages, removes orphaned tool results, targets 60% of model context window.

### Provider Examples

Add usage examples for each provider inline in the Providers section: Ollama, OpenAI, Anthropic, OpenRouter, llama.cpp, LM Studio. Include `--model` flag syntax and env var for API keys.

---

## 2. Session Resume/Fork

**Goal:** Add `--continue` and `--fork` CLI flags, plus `/fork` slash command.

### `--continue` Flag

Resume the most recent session without needing to know the session ID.

**Implementation:**
- Add `getLastSessionId()` to `src/harness/session.ts` — reads session files from `~/.oh/sessions/`, returns the one with the most recent timestamp
- Add `--continue` flag to the `chat` command in `main.tsx`
- When set, call `getLastSessionId()` and pass as `resumeSessionId` to the REPL

### `--fork <id>` Flag

Create a new session branching from an existing one.

**Implementation:**
- In `main.tsx`, when `--fork <id>` is provided: load the source session, create a new session with a fresh ID, copy the messages array from the source
- Pass to REPL as a normal session with `initialMessages` set

### `/fork` Slash Command

Fork the current session mid-conversation.

**Implementation:**
- In `commands/index.ts`, register `/fork` command
- Creates a new session with current messages, saves it, returns the new session ID
- The current session continues unchanged — the fork is a snapshot the user can resume later with `--resume <id>`

---

## 3. Extended Thinking Support

**Goal:** Display model thinking/reasoning in a dimmed format above the response for Anthropic, OpenAI o-series, and Ollama models.

### New Stream Event

Add to `src/types/events.ts`:
```ts
export type ThinkingDelta = {
  readonly type: "thinking_delta";
  readonly content: string;
};
```

Add `ThinkingDelta` to the `StreamEvent` union.

### Anthropic Provider

In `src/providers/anthropic.ts`:
- When model starts with `claude-` (all Claude models support thinking), add `thinking: { type: "enabled", budget_tokens: 10000 }` to the request body
- Parse `content_block_start` where `content_block.type === "thinking"` — set a flag `inThinkingBlock = true`
- When `inThinkingBlock` and `content_block_delta` has `delta.type === "thinking_delta"`, yield `{ type: "thinking_delta", content: delta.thinking }`
- On `content_block_stop`, reset `inThinkingBlock = false`

### OpenAI Provider

In `src/providers/openai.ts`:
- For o1/o3 models, set `reasoning_effort: "medium"` in the request body
- In streaming, check for `delta.reasoning_content` — if present, yield `{ type: "thinking_delta", content: delta.reasoning_content }`

### Ollama Provider

In `src/providers/ollama.ts`:
- Buffer incoming `text_delta` content
- Detect `<think>` opening tag — start buffering to a thinking accumulator instead of yielding text_delta
- Detect `</think>` closing tag — yield accumulated content as `thinking_delta`, resume normal text_delta
- Handle partial tags across chunk boundaries with a simple state machine

### UI Display

In `src/components/REPL.tsx`:
- Add `thinkingText` state alongside `streamingText`
- On `thinking_delta` events: append to `thinkingText`
- Display above the streaming response as dimmed text: `💭 {thinkingText}` with `<Text dimColor>`
- Clear `thinkingText` when turn completes

### Config

Add `thinking: boolean` to `OhConfig` in `config.ts`. Default: `true`. When `false`, skip thinking parameters in provider requests (saves tokens/cost).

---

## 4. MCP Server Improvements

**Goal:** Per-tool risk levels, configurable timeout, auto-restart on crash.

### Per-Tool Risk Level

In `src/harness/config.ts`, add optional `riskLevel` to `McpServerConfig`:
```ts
export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  riskLevel?: "low" | "medium" | "high";  // default: "medium"
  timeout?: number;  // ms, default: 5000
};
```

In `src/mcp/McpTool.ts`, use the server's `riskLevel` instead of hardcoded `"medium"`.

### Configurable Timeout

Pass the server's `timeout` value to `McpClient.connect()`. Use it for both the connection timeout and individual tool call timeouts.

### Auto-Restart

In `src/mcp/client.ts`:
- Track whether the server process has exited
- On next `callTool()` after exit, attempt one reconnect (`connect()` again)
- If reconnect fails, return an error result
- No infinite restart loops — one attempt only

---

## Delivery

- Single branch `feat/v050-features`
- One PR with all 4 areas
- Each gets its own commit(s)
- `npm run build` and `npm test` must pass
