# Tier 2 + Tier 3 Combined Design Spec

**Date:** 2026-04-05
**Scope:** 4 features — provider tests, smarter /compact, permission modes, hooks system

---

## 1. Provider Unit Tests

**Goal:** Test `fetchModels()` and `healthCheck()` for all providers that implement them.

**Providers to test:** Ollama, OpenAI, Anthropic, LlamaCpp (LM Studio is just LlamaCpp with different port, no separate tests needed).

**Test approach:**
- One test file per provider: `src/providers/ollama.test.ts`, `openai.test.ts`, `anthropic.test.ts`, `llamacpp.test.ts`
- Mock HTTP responses using Node's built-in `test` runner and `assert/strict` (consistent with existing tests)
- Mock `fetch` globally with a custom implementation that returns canned responses
- Test both success and error paths for `fetchModels()` and `healthCheck()`

**What to test per provider:**
- `fetchModels()` → returns correct model list from mocked API response
- `fetchModels()` → handles network error gracefully
- `healthCheck()` → returns true when server responds OK
- `healthCheck()` → returns false when server is unreachable

---

## 2. Smarter `/compact` Command

**Current state:** `/compact` in `commands/index.ts` uses a naive "keep system + last 10 non-system" approach. Meanwhile `compressMessages` in `query.ts` is smarter (truncates old tool results first, then drops oldest messages, then removes orphaned tool results).

**Fix:** Make `/compact` reuse `compressMessages` with a target of 60% context window.

**Changes:**
- Export `compressMessages` from `query.ts`
- In `/compact` handler, call `compressMessages(ctx.messages, targetTokens)` where `targetTokens = getContextWindow(ctx.model) * 0.6`
- `getContextWindow` is already exported from `cost.ts`
- Add `model` to `CommandContext` if not already present (it is — `ctx.model` exists)
- Remove the old naive implementation

---

## 3. Permission Modes — `acceptEdits` and `plan`

**Current modes:** `ask`, `trust`, `deny`

**New modes:**

### `acceptEdits`
Auto-approve file operations, ask for everything else.

**Auto-approved tools:** FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool, LSTool, ImageReadTool, NotebookEditTool
**Ask-required tools:** BashTool, WebFetchTool, WebSearchTool, AgentTool, all others

**Implementation:** In `checkPermission` (`src/types/permissions.ts`), add case for `"acceptEdits"`. Check if the tool is in the auto-approved set. If yes, allow. If no, fall through to `"ask"` behavior.

### `plan`
Read-only mode — only allow tools that are read-only.

**Implementation:** In `checkPermission`, add case for `"plan"`. Call `tool.isReadOnly(input)` — if true, allow; if false, deny.

**Other changes:**
- Add `"acceptEdits"` and `"plan"` to the `PermissionMode` type union in `permissions.ts`
- Update CLI `--permission` flag parser in `main.tsx` to accept new modes
- Update `/help` command output to list all 5 modes
- Add tests for the new modes in `permissions.test.ts`

---

## 4. Hooks System

**Goal:** Run shell commands on specific events, configured in `.oh/config.yaml`.

### Configuration

In `.oh/config.yaml`, add an optional `hooks` section:

```yaml
hooks:
  sessionStart:
    - command: "echo session started"
  preToolUse:
    - match: "Bash"
      command: "./scripts/lint-bash-command.sh"
  postToolUse:
    - command: "echo tool done"
  sessionEnd:
    - command: "echo bye"
```

### Event Types

| Event | When | Can block? |
|-------|------|-----------|
| `sessionStart` | After Ink render starts, before first prompt | No |
| `sessionEnd` | On exit (cleanup effect) | No |
| `preToolUse` | Before tool.call() executes | Yes (exit code 1 = block) |
| `postToolUse` | After tool.call() completes | No |

### Hook Execution

- `spawnSync(command, { shell: true, timeout: 10_000, stdio: "pipe" })`
- Environment variables passed: `OH_EVENT`, `OH_TOOL_NAME`, `OH_TOOL_ARGS` (JSON), `OH_TOOL_OUTPUT` (for postToolUse)
- `preToolUse` hooks: if any hook exits non-zero, the tool call is blocked and an error result is returned to the LLM
- Multiple hooks per event run sequentially

### New Files

- `src/harness/hooks.ts` — loads hook config from `.oh/config.yaml`, exports `emitHook(event, context)` function
- Update `src/harness/config.ts` — add `hooks` field to the config type

### Integration Points

- `src/query.ts` — call `emitHook("preToolUse", ...)` before `tool.call()`, `emitHook("postToolUse", ...)` after
- `src/main.tsx` — call `emitHook("sessionStart")` after render, `emitHook("sessionEnd")` on exit

---

## Delivery

- Single branch `feat/tier2-tier3`
- One PR with all 4 features
- Each feature gets its own commit(s) for clean history
- `npm run build` and `npm test` must pass
