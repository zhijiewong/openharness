# Hooks

Hooks let you run arbitrary commands or HTTP callbacks at well-defined points in openHarness's execution. Configure them in `.oh/config.yaml` under the `hooks:` key.

## Events

| Event | Fires | Can block? | Notes |
|---|---|---|---|
| `sessionStart` | When a REPL session starts | No | |
| `sessionEnd` | When a REPL session ends | No | |
| `preToolUse` | Before any tool executes | **Yes** | Return `{decision: "deny"}` to block. |
| `postToolUse` | After a tool executes successfully | No | Does NOT fire if the tool errored — see `postToolUseFailure`. |
| `postToolUseFailure` | After a tool throws OR returns `isError: true` | No | Notify-only. Mutually exclusive with `postToolUse`. |
| `userPromptSubmit` | Before the user's prompt reaches the LLM | **Yes** | Can also prepend context — see below. |
| `permissionRequest` | When a tool permission check says "needs approval" | **Yes** | 3-state: `allow` / `deny` / `ask`. |
| `fileChanged` | After a tool edits a file | No | |
| `cwdChanged` | When `cd` changes the working directory | No | |
| `subagentStart` | When an AgentTool invocation starts | No | |
| `subagentStop` | When an AgentTool invocation ends | No | |
| `preCompact` | Before conversation history is compacted | No | |
| `postCompact` | After compaction completes | No | |
| `configChange` | When `.oh/config.yaml` changes on disk | No | |
| `notification` | Reserved for future use | No | |

## Two hook modes

### JSON I/O mode (`jsonIO: true`)

The hook receives a JSON envelope on stdin and writes a JSON response on stdout. This is the preferred mode for blocking hooks and for hooks that want to prepend context.

**Stdin (input):**
```json
{
  "event": "userPromptSubmit",
  "prompt": "the user's prompt text",
  "sessionId": "...",
  "model": "anthropic/claude-opus-4-7",
  "provider": "anthropic",
  "permissionMode": "ask"
}
```

Fields vary by event — see the event reference below.

**Stdout (response):**
```json
{
  "decision": "allow" | "deny",
  "reason": "optional string shown to the user on deny",
  "hookSpecificOutput": {
    "additionalContext": "string prepended to the prompt (userPromptSubmit only)",
    "decision": "allow" | "deny" | "ask"
  }
}
```

All fields are optional. Unknown fields are ignored. Malformed JSON is treated as an empty response.

### Env-mode (default)

The hook is a shell command. Context fields are passed via `OH_*` environment variables. Exit code gates the decision:

| Event | Exit 0 | Nonzero exit |
|---|---|---|
| `preToolUse` | allow | deny (tool blocked) |
| `userPromptSubmit` | allow | deny (prompt blocked with generic message) |
| `permissionRequest` | fall through to interactive ask | deny |
| `postToolUseFailure` | (ignored — notify-only) | (ignored) |
| all other events | (ignored — fire-and-forget) | (ignored) |

Env vars set per event:
- `OH_EVENT` — the event name
- `OH_TOOL_NAME`, `OH_TOOL_ARGS`, `OH_TOOL_OUTPUT`, `OH_TOOL_INPUT_JSON` — for tool events
- `OH_PROMPT` — for `userPromptSubmit` (capped at 8KB on all platforms)
- `OH_TOOL_ERROR`, `OH_ERROR_MESSAGE` — for `postToolUseFailure`
- `OH_PERMISSION_ACTION` — for `permissionRequest` (value: `ask`, `allow`, or `deny`)
- `OH_SESSION_ID`, `OH_MODEL`, `OH_PROVIDER`, `OH_PERMISSION_MODE`

## Examples

### Fail-log on every tool failure

```yaml
hooks:
  postToolUseFailure:
    - command: >-
        sh -c 'echo "[$(date)] $OH_TOOL_NAME failed: $OH_ERROR_MESSAGE" >> /tmp/oh-fails.log'
```

### Prepend a standing instruction to every user prompt

```yaml
hooks:
  userPromptSubmit:
    - command: node ./prepend-context.cjs
      jsonIO: true
```

`./prepend-context.cjs`:
```js
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: "[system: always respond in under 200 words unless asked otherwise]",
    },
  }));
});
```

### Deny Bash in "ask" mode without prompting

```yaml
hooks:
  permissionRequest:
    - command: node ./gate-bash.cjs
      jsonIO: true
      match: "Bash"
```

`./gate-bash.cjs`:
```js
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { decision: "deny", reason: "Bash is disabled by policy" },
  }));
});
```

## Multi-hook merge

You can configure multiple hooks per event. They run in order. Merge rules:
- First `deny` (in `decision` or `hookSpecificOutput.decision`) short-circuits — remaining hooks do NOT run.
- First `hookSpecificOutput.decision: "allow"` short-circuits — remaining hooks do NOT run.
- Multiple `hookSpecificOutput.additionalContext` values concatenate in hook-list order, separated by `\n\n`.
- If any hook returns `"ask"` and none deny or allow, the final `permissionDecision` is `"ask"` (fall through).

## Pattern matching with `match`

Filter a hook by tool name: substring, glob-style, or regex:

```yaml
hooks:
  preToolUse:
    - command: ./log.sh
      match: "Bash"           # substring
    - command: ./watch.sh
      match: "File*"          # glob
    - command: ./mcp-audit.sh
      match: "/mcp__.*/"      # regex
```

## Claude Code compatibility

openHarness mirrors Claude Code's hook semantics where possible. Notable differences:
- openHarness uses **camelCase** context field names (`toolName`, `toolInput`); Claude Code uses **snake_case** (`tool_name`, `tool_input`). Snake_case aliases are not yet supported.
- openHarness does not yet support prompt *rewriting* via `userPromptSubmit` — only prepending via `additionalContext`.

## Timeouts and gotchas

- Default hook timeout: **10 seconds**. Override per-hook with `timeout: <ms>`.
- `userPromptSubmit` runs between keypress and LLM dispatch — keep it fast.
- `OH_PROMPT` is truncated to 8KB to fit within Windows env-var length limits.
- `permissionRequest` fires ONLY in the `needs-approval && askUser` branch. If the tool is pre-approved (permissionMode: trust, or matching allow rule) OR pre-denied, the hook does not fire.
- Biome / lint / format: openHarness's pre-commit hook runs `biome check` — ensure your hook scripts don't trip it if they live in the repo.
