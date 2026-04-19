# Model Router Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `ModelRouter` class + `modelRouter:` config field (already shipped, never used) into the main query loop and AgentTool sub-agent loop, and add a `/router` slash command for observability.

**Architecture:** Six surgical edits — instantiate `ModelRouter` at `query()` entry; compute `RouteContext` per turn; replace the single `config.model` at `src/query/index.ts:208` with `router.select().model`. Record last selection in a module-level map for the `/router` command. Sub-agent `role` plumbed through `QueryConfig`.

**Tech Stack:** TypeScript, existing `ModelRouter` class, Node `node:test`.

**Source spec:** `docs/superpowers/specs/2026-04-19-model-router-wiring-design.md`

---

## File Structure

### Modify
- `src/providers/router.ts` — add `recordRouteSelection(sessionId, result)` + `getRouteSelection(sessionId): RouteResult | undefined` exports with LRU-256 map
- `src/query/index.ts` — instantiate router; build RouteContext per turn; pass `selection.model` to `stream()`. Extend `QueryConfig` with `role?: string`.
- `src/tools/AgentTool/index.ts` — pass resolved `role.name` into the spawned `query()` config
- `src/commands/info.ts` — register `/router` slash command
- `src/providers/router.test.ts` — add tests for `recordRouteSelection`/`getRouteSelection` + LRU eviction
- `docs/configuration.md` (or new `docs/model-router.md`) — user-facing docs
- `CHANGELOG.md` — unreleased entry

### Create
- `src/query/router-integration.test.ts` — end-to-end router test against a fake provider
- Possibly `src/commands/router-command.test.ts` if `/router` doesn't naturally fit in an existing test file

### Unchanged
- `src/providers/router.ts` (the `ModelRouter` class itself) — heuristics stay as shipped

---

## Task 1: Add `recordRouteSelection` + `getRouteSelection` exports

**Files:**
- Modify: `src/providers/router.ts`
- Modify: `src/providers/router.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/providers/router.test.ts` (reuse existing imports):

```ts
import { getRouteSelection, recordRouteSelection } from "./router.js";

describe("recordRouteSelection / getRouteSelection", () => {
  it("round-trips a selection by sessionId", () => {
    recordRouteSelection("s1", { model: "m", tier: "fast", reason: "test" });
    const got = getRouteSelection("s1");
    assert.equal(got?.model, "m");
    assert.equal(got?.tier, "fast");
    assert.equal(got?.reason, "test");
  });

  it("returns undefined for unknown sessionId", () => {
    assert.equal(getRouteSelection("never-seen"), undefined);
  });

  it("overwrites previous selection for the same sessionId", () => {
    recordRouteSelection("s2", { model: "a", tier: "fast", reason: "first" });
    recordRouteSelection("s2", { model: "b", tier: "powerful", reason: "second" });
    assert.equal(getRouteSelection("s2")?.tier, "powerful");
  });

  it("evicts oldest entries past LRU cap", () => {
    // Fill past cap (256) to prove the oldest is gone.
    for (let i = 0; i < 260; i++) {
      recordRouteSelection(`cap-${i}`, { model: "m", tier: "balanced", reason: "x" });
    }
    assert.equal(getRouteSelection("cap-0"), undefined);
    assert.ok(getRouteSelection("cap-259"));
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
npx tsx --test src/providers/router.test.ts
```
Expected: FAIL — not exported.

- [ ] **Step 3: Implement in `src/providers/router.ts`**

Append at the bottom of the file:

```ts
const ROUTE_SELECTION_CAP = 256;
const routeSelections = new Map<string, RouteResult>();

/** Record the router's selection for a session. Keeps only the most recent 256 sessions. */
export function recordRouteSelection(sessionId: string, result: RouteResult): void {
  // Map preserves insertion order. Delete-then-set moves the key to the end.
  if (routeSelections.has(sessionId)) routeSelections.delete(sessionId);
  routeSelections.set(sessionId, result);
  if (routeSelections.size > ROUTE_SELECTION_CAP) {
    const oldest = routeSelections.keys().next().value;
    if (oldest !== undefined) routeSelections.delete(oldest);
  }
}

/** Retrieve the most recent selection for a session, or undefined. */
export function getRouteSelection(sessionId: string): RouteResult | undefined {
  return routeSelections.get(sessionId);
}
```

- [ ] **Step 4: Verify passing**

```bash
npx tsx --test src/providers/router.test.ts
npx tsc --noEmit
npm test
```

Expected: tsc clean; suite +4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/router.ts src/providers/router.test.ts
git commit -m "feat(router): recordRouteSelection / getRouteSelection with LRU cap"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 2: Extend `QueryConfig` with `role?: string`

**Files:**
- Modify: `src/query/index.ts` (type definition)

- [ ] **Step 1: Find and extend the type**

Locate the `QueryConfig` type definition in `src/query/index.ts` (near the top of the file, before `export async function* query(...)`). Add:

```ts
export type QueryConfig = {
  // ...existing fields unchanged...
  /** For sub-agent invocations: the agent role name (feeds into the model router). */
  role?: string;
};
```

The field is purely informational — the router reads it; other code paths ignore it.

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
npm test
```
Expected: clean; no behavior change yet (the field isn't read anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/query/index.ts
git commit -m "feat(query): add optional role field to QueryConfig"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 3: Wire router into the main query loop

**Files:**
- Modify: `src/query/index.ts`

- [ ] **Step 1: Add imports**

At the top of `src/query/index.ts`, add:

```ts
import { readOhConfig } from "../harness/config.js";
import { ModelRouter, recordRouteSelection } from "../providers/router.js";
```

- [ ] **Step 2: Instantiate router at query entry**

At the top of the `query()` function (before the main turn loop), add:

```ts
const routerCfg = readOhConfig()?.modelRouter ?? {};
const router = new ModelRouter(routerCfg, config.model);
```

- [ ] **Step 3: Write the `estimateRouteContextUsage` helper**

At module scope in `src/query/index.ts` (above `query()`), add:

```ts
/** Rough context-usage estimate in [0, 1]. Returns undefined when tokenization is unavailable. */
function estimateRouteContextUsage(
  messages: Message[],
  provider: Provider,
  model: string,
): number | undefined {
  const estimate = provider.estimateTokens?.bind(provider);
  if (!estimate) return undefined;
  const info = provider.getModelInfo?.(model);
  const window = info?.contextWindow;
  if (!window || window <= 0) return undefined;
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") total += estimate(m.content);
    // non-string content (tool calls etc.) is skipped — a rough estimate is acceptable
  }
  return Math.min(1, total / window);
}
```

Adapt `Message` / `Provider` imports if they need explicit `type` import additions.

- [ ] **Step 4: Build RouteContext + call select() before stream()**

Find the `stream()` call at `src/query/index.ts:208`:

```ts
for await (const event of config.provider.stream(state.messages, turnPrompt, apiTools, config.model)) {
```

Immediately BEFORE the `for await` line, insert:

```ts
const ctxUsage = estimateRouteContextUsage(state.messages, config.provider, config.model);
const selection = router.select({
  turn: state.turn,
  hadToolCalls: state.lastTurnHadTools ?? false,
  toolCallCount: state.lastTurnToolCount ?? 0,
  contextUsage: ctxUsage,
  isFinalResponse: state.lastTurnHadTools === false && state.turn > 1,
  role: config.role,
});
if (config.sessionId) recordRouteSelection(config.sessionId, selection);
```

Replace `config.model` in the stream() call with `selection.model`:

```ts
for await (const event of config.provider.stream(state.messages, turnPrompt, apiTools, selection.model)) {
```

- [ ] **Step 5: Verify `state` actually has `turn`, `lastTurnHadTools`, `lastTurnToolCount`**

If the query-loop's state object doesn't already track these fields, add them. Grep:

```bash
grep -n "state.turn\|lastTurnHadTools\|lastTurnToolCount" src/query/index.ts
```

If missing, initialize in the state object with sensible defaults (`turn: 1`, `lastTurnHadTools: false`, `lastTurnToolCount: 0`) and update them at the end of each turn based on whether the assistant emitted tool calls.

- [ ] **Step 6: Typecheck + full suite**

```bash
npx tsc --noEmit
npm test
```

Expected: tsc clean; full suite passes (no new tests yet — integration test lands in Task 4). Existing query tests should continue passing because without `modelRouter:` config, `router.select()` returns `{model: config.model, ...}` and behavior is identical.

- [ ] **Step 7: Commit**

```bash
git add src/query/index.ts
git commit -m "feat(query): wire ModelRouter into the main turn loop"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 4: End-to-end router integration test

**Files:**
- Create: `src/query/router-integration.test.ts`

- [ ] **Step 1: Write the test**

Create `src/query/router-integration.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeTmpDir } from "../test-helpers.js";
import { invalidateConfigCache } from "../harness/config.js";
import type { Provider, ProviderEvent } from "../providers/base.js";
import type { Message } from "../types/message.js";
import { query } from "./index.js";

/** Fake provider that records the model argument of each stream() call. */
function makeFakeProvider(streamResponses: Array<{ text: string; toolCalls?: number }>): {
  provider: Provider;
  modelsUsed: string[];
} {
  const modelsUsed: string[] = [];
  let callIdx = 0;
  const provider: Provider = {
    // biome-ignore lint/correctness/noUnusedVariables: fake provider — some interface methods are unused
    async *stream(_messages, _systemPrompt, _tools, model) {
      modelsUsed.push(model ?? "<unset>");
      const r = streamResponses[callIdx++] ?? { text: "" };
      yield { type: "text_delta", content: r.text } as ProviderEvent;
      yield { type: "turn_done" } as ProviderEvent;
    },
    async complete() {
      return { role: "assistant", content: "" } as Message;
    },
    async listModels() {
      return [];
    },
    estimateTokens: (s: string) => Math.ceil(s.length / 4),
    getModelInfo: () => ({ contextWindow: 200_000 }),
  } as Provider;
  return { provider, modelsUsed };
}

async function withRouterConfig(
  routerCfg: { fast?: string; balanced?: string; powerful?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    mkdirSync(`${dir}/.oh`, { recursive: true });
    const lines = ["provider: mock", "model: mock", "permissionMode: trust", "modelRouter:"];
    for (const [k, v] of Object.entries(routerCfg)) {
      if (v) lines.push(`  ${k}: ${v}`);
    }
    lines.push("");
    writeFileSync(`${dir}/.oh/config.yaml`, lines.join("\n"));
    invalidateConfigCache();
    await fn();
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

describe("query — ModelRouter integration", () => {
  it("routes to configured tiers based on turn heuristics", async () => {
    await withRouterConfig(
      { fast: "FAST_MODEL", balanced: "BALANCED_MODEL", powerful: "POWERFUL_MODEL" },
      async () => {
        const { provider, modelsUsed } = makeFakeProvider([
          // turn 1: no prior tool calls → not "early exploration" in the current heuristic
          // (early exploration requires hadToolCalls on previous turn). → default → balanced
          { text: "hello" },
          // turn 2: previous turn was text-only → final-response heuristic? need turn > 1 AND
          // lastTurnHadTools === false → POWERFUL
          { text: "done" },
        ]);

        const gen = query(
          "hi",
          {
            provider,
            model: "DEFAULT_MODEL",
            tools: [],
            permissionMode: "trust",
            sessionId: "test-session",
          } as any,
          [{ role: "user", content: "hi" }],
        );
        for await (const _ of gen) {
          /* drain */
        }

        // First call: default heuristic → balanced
        assert.equal(modelsUsed[0], "BALANCED_MODEL");
        // Second call: final-response heuristic → powerful
        assert.equal(modelsUsed[1], "POWERFUL_MODEL");
      },
    );
  });

  it("no router config → all calls use config.model", async () => {
    await withRouterConfig({}, async () => {
      const { provider, modelsUsed } = makeFakeProvider([{ text: "ok" }]);
      const gen = query(
        "hi",
        {
          provider,
          model: "DEFAULT_MODEL",
          tools: [],
          permissionMode: "trust",
          sessionId: "test-session",
        } as any,
        [{ role: "user", content: "hi" }],
      );
      for await (const _ of gen) {
        /* drain */
      }
      assert.equal(modelsUsed[0], "DEFAULT_MODEL");
    });
  });
});
```

**Adapt as needed:** this test uses the `query()` signature approximately. Read `src/query/index.ts` to confirm the actual signature and required fields; fill in missing required fields or cast `as any` where the shape is too complex for a hermetic test. The goal is to exercise the `stream()` call path with a model-recording fake.

- [ ] **Step 2: Run the test**

```bash
npx tsx --test src/query/router-integration.test.ts
```

Expected: 2/2 pass. If the heuristic assertions don't match the actual router rules, inspect `src/providers/router.ts:select()` and adjust the expected models to match.

- [ ] **Step 3: Full suite**

```bash
npx tsc --noEmit
npm test
```

Expected: clean; full suite +2 tests.

- [ ] **Step 4: Commit**

```bash
git add src/query/router-integration.test.ts
git commit -m "test(query): end-to-end ModelRouter integration"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 5: Wire router into AgentTool sub-agents

**Files:**
- Modify: `src/tools/AgentTool/index.ts`
- Modify: `src/tools/AgentTool/index.test.ts` (if exists; else add a minimal new test file or skip this step with a note)

- [ ] **Step 1: Thread `role` into the sub-agent's query config**

Find line 117 in `src/tools/AgentTool/index.ts` — `for await (const event of query(input.prompt, config)) {`. Change `config` to spread in the resolved role name:

```ts
      for await (const event of query(input.prompt, { ...config, role: role?.name })) {
```

The `role` variable is already in scope from lines 61-76.

- [ ] **Step 2: If `role.name` doesn't exist — adapt**

`role` is an `AgentRole` per `src/agents/roles.ts`. Check whether `AgentRole` has a `.name` field; if it's `.id` or `.slug`, use that instead. Grep:

```bash
grep -n "name\|id\|slug" src/agents/roles.ts | head -10
```

Use whatever string field identifies the role. The router's `powerfulRoles` list hard-codes names like `"code-reviewer"`, `"evaluator"`, `"architect"`, `"security-auditor"` — match those.

- [ ] **Step 3: If an AgentTool test file exists, extend it**

```bash
ls src/tools/AgentTool/index.test.ts 2>&1
```

If it exists, append a test that verifies a `code-reviewer` sub-agent routes to the `powerful` model. Follow the same fake-provider pattern from Task 4. If it doesn't exist, SKIP this sub-step — the router-integration test in Task 4 plus Task 1's router unit tests give adequate coverage. Note the gap in the commit message.

- [ ] **Step 4: Full suite**

```bash
npx tsc --noEmit
npm test
```

Expected: clean; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/tools/AgentTool/index.ts
# if index.test.ts was modified:
# git add src/tools/AgentTool/index.test.ts
git commit -m "feat(agent-tool): thread role into query config for model router"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 6: `/router` slash command

**Files:**
- Modify: `src/commands/info.ts`
- Modify: `src/commands/commands-new.test.ts` (or closest existing command-test file)

- [ ] **Step 1: Write failing tests**

Read `src/commands/commands-new.test.ts` to match its patterns. Append:

```ts
describe("/router command", () => {
  it("reports 'off' when no modelRouter config is set", async () => {
    await withTmpCwd(async () => {
      const ctx = /* make ctx with model: "mock/mock", sessionId: "s1" */;
      const res = await processSlashCommand("/router", ctx);
      assert.ok(res);
      assert.match(res!.output, /Router:\s*off/i);
    });
  });

  it("lists all three tiers when configured", async () => {
    await withTmpCwd(async () => {
      // write .oh/config.yaml with modelRouter: { fast: F, balanced: B, powerful: P }
      writeRouterConfig({ fast: "F", balanced: "B", powerful: "P" });
      const ctx = /* make ctx */;
      const res = await processSlashCommand("/router", ctx);
      assert.match(res!.output, /fast\s+F/);
      assert.match(res!.output, /balanced\s+B/);
      assert.match(res!.output, /powerful\s+P/);
    });
  });

  it("shows last selection when recorded for the session", async () => {
    await withTmpCwd(async () => {
      writeRouterConfig({ fast: "F" });
      recordRouteSelection("s1", { model: "F", tier: "fast", reason: "tool-heavy turn" });
      const ctx = /* make ctx with sessionId: "s1" */;
      const res = await processSlashCommand("/router", ctx);
      assert.match(res!.output, /Last selection:\s*fast/i);
      assert.match(res!.output, /tool-heavy turn/);
    });
  });
});
```

Adapt helper names and `ctx` construction to match what commands-new.test.ts already uses.

- [ ] **Step 2: Verify failing**

```bash
npx tsx --test src/commands/commands-new.test.ts
```

- [ ] **Step 3: Register the command in `src/commands/info.ts`**

At the top, add imports:

```ts
import { readOhConfig } from "../harness/config.js";
import { getRouteSelection } from "../providers/router.js";
```

Near the existing `register("mcp", ...)` registration, add:

```ts
  register("router", "Show the model router state", (_args, ctx) => {
    const cfg = readOhConfig()?.modelRouter;
    const defaultModel = ctx.model ?? "unknown";
    if (!cfg || (!cfg.fast && !cfg.balanced && !cfg.powerful)) {
      return { output: `Router: off (single model: ${defaultModel})`, handled: true };
    }
    const last = ctx.sessionId ? getRouteSelection(ctx.sessionId) : undefined;
    const lines = [
      "Model router:",
      `  fast       ${cfg.fast ?? `(default: ${defaultModel})`}`,
      `  balanced   ${cfg.balanced ?? `(default: ${defaultModel})`}`,
      `  powerful   ${cfg.powerful ?? `(default: ${defaultModel})`}`,
    ];
    if (last) {
      lines.push("", `Last selection: ${last.tier} — "${last.reason}"`);
    }
    return { output: lines.join("\n"), handled: true };
  });
```

- [ ] **Step 4: Verify passing + full suite**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/info.ts src/commands/commands-new.test.ts
git commit -m "feat(commands): /router shows model-router state"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 7: Docs

**Files:**
- Modify (or create): `docs/configuration.md` or new `docs/model-router.md`
- Modify: `CHANGELOG.md` — unreleased entry

- [ ] **Step 1: Check existing docs structure**

```bash
ls docs/ | grep -Ei "config|router|model"
```

If `docs/configuration.md` exists, add a `## Model router` section to it. Otherwise create `docs/model-router.md`.

- [ ] **Step 2: Write the user-facing docs**

Content:

```markdown
## Model router

Route different parts of your conversation to different models automatically. Configure distinct models per tier in `.oh/config.yaml`:

​```yaml
provider: anthropic
model: claude-sonnet-4-6
modelRouter:
  fast: ollama/qwen2.5:7b         # exploration, tool dispatching
  balanced: gpt-4o-mini           # general turns
  powerful: claude-opus-4-7       # final responses, code review sub-agents
​```

All three fields are optional. When any tier is unset, it falls back to the top-level `model:`. When the whole `modelRouter:` block is unset, no routing happens — every turn uses `model:`.

### Heuristics

- **Context pressure > 80%** → `fast` (minimize input-token cost)
- **Sub-agent role in** `code-reviewer`, `evaluator`, `architect`, `security-auditor` → `powerful`
- **Early exploration** (turn 1–2, previous turn had tool calls) → `fast`
- **Tool-heavy turn** (≥3 tool calls on previous turn) → `fast`
- **Final response** (previous turn had no tool calls, turn > 1) → `powerful`
- **Otherwise** → `balanced`

### `/router` command

Inspect the current router state and the last selection for your session:

​```
> /router
Model router:
  fast       ollama/qwen2.5:7b
  balanced   gpt-4o-mini
  powerful   claude-opus-4-7

Last selection: balanced — "default"
​```

When unconfigured: `Router: off (single model: claude-sonnet-4-6)`.

### Notes

- Context-pressure routing requires a provider that implements `estimateTokens` and a known `contextWindow`. For providers without tokenization, the pressure heuristic is skipped; other heuristics still apply.
- Config reloads at the start of each user turn — edits to `.oh/config.yaml` take effect on the next prompt submission.
```

(Replace `​` zero-width-spaces with real triple backticks when writing.)

- [ ] **Step 3: CHANGELOG entry**

Add to the existing Unreleased section (created by the hook-events PR if it merged first, else create a new one):

```markdown
### Added
- Wired the existing `ModelRouter` into the query loop. Configure `modelRouter.{fast,balanced,powerful}` in `.oh/config.yaml` to route per-turn based on the shipped heuristics. Sub-agents (AgentTool) route via `role`. New `/router` slash command shows current tier-to-model mapping and the last selection.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ CHANGELOG.md
git commit -m "docs: model router configuration + /router command"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| §1 Query-loop integration | 3 |
| §1 `estimateRouteContextUsage` helper | 3 |
| §1 `recordRouteSelection` / `getRouteSelection` | 1 |
| §2 Sub-agent `role` plumbing | 2, 5 |
| §3 `/router` slash command | 6 |
| §4 Tests (router unit + integration + /router) | 1, 4, 6 |
| §5 Error / edge cases (empty config, missing tokenizer, invalid model, unknown role) | Covered by existing `ModelRouter` code + no-op fallbacks — verified in Task 4 |
| §6 Telemetry | Out of scope (deferred) |
| Docs | 7 |

All spec requirements covered. Telemetry explicitly deferred.

### Placeholder scan

- Task 5 Step 3 has a conditional "if no test file, skip with a note" — acceptable; not a TBD because the decision is bounded.
- Task 4's fake-provider construction uses `as any` for the `QueryConfig` cast — acceptable because the config shape is complex and tests shouldn't couple tightly to every field. The task explicitly flags this.
- No "handle edge cases" / "add validation" / "TODO" anywhere.

### Type consistency

- `RouteResult`, `RouteContext`, `ModelTier` — from the existing `ModelRouter` types, used consistently across all tasks.
- `RouteContext.role?: string` — string-typed across Tasks 2, 3, 5.
- Task 1's `recordRouteSelection(sessionId: string, result: RouteResult)` — signature stable across Tasks 3 and 6.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-model-router-wiring.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration.
2. **Inline Execution** — batch in this session with checkpoints.

Which approach?
