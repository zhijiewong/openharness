# Fallback Providers Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `createFallbackProvider` function (shipped in `src/providers/fallback.ts` but unused and untested) into `createProvider()` so users can configure `fallbackProviders:` and have them activate on pre-stream retriable errors. Final of three v2.13.0 features.

**Architecture:** One-function change in `src/providers/index.ts` + `console.warn` added at the transition point inside `createFallbackProvider`. Full test coverage added for the class + the wiring. Release prep is a separate follow-up commit after model router #33 merges.

**Tech Stack:** TypeScript, existing provider factory, Node `node:test`.

**Source spec:** `docs/superpowers/specs/2026-04-19-fallback-providers-wiring-design.md`

---

## File Structure

### Modify
- `src/providers/index.ts` — add fallback-chain construction + wrap primary when `fallbackProviders:` is set
- `src/providers/fallback.ts` — add one `console.warn` line at the fallback-transition point (stream + complete paths)
- `docs/configuration.md` — add `## Fallback providers` section
- `CHANGELOG.md` — add entry to existing Unreleased

### Create
- `src/providers/fallback.test.ts` — 7 unit tests for `createFallbackProvider`
- `src/providers/index.test.ts` — 2 tests for factory wiring (or extend if it already exists)

### Unchanged
- `src/harness/config.ts` — `fallbackProviders?:` type is already correct
- All `main.tsx` call sites of `createProvider` — the factory's return value is a drop-in Provider

---

## Task 1: Unit tests for `createFallbackProvider`

**Files:**
- Create: `src/providers/fallback.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/providers/fallback.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Provider } from "./base.js";
import type { StreamEvent } from "../types/events.js";
import type { Message } from "../types/message.js";
import { createFallbackProvider } from "./fallback.js";

/** Build a minimal fake Provider that matches the interface for these tests. */
function fakeProvider(opts: {
  name: string;
  streamEvents?: StreamEvent[];
  streamError?: Error;
  streamErrorAfterEvents?: number;
  completeResult?: Message;
  completeError?: Error;
} = { name: "fake" }): Provider {
  return {
    name: opts.name,
    async *stream(_messages, _systemPrompt, _tools, _model) {
      if (opts.streamErrorAfterEvents !== undefined) {
        const events = opts.streamEvents ?? [];
        for (let i = 0; i < Math.min(events.length, opts.streamErrorAfterEvents); i++) {
          yield events[i]!;
        }
        throw opts.streamError ?? new Error("mid-stream error");
      }
      if (opts.streamError) throw opts.streamError;
      for (const e of opts.streamEvents ?? []) yield e;
    },
    async complete(_messages, _systemPrompt, _tools, _model) {
      if (opts.completeError) throw opts.completeError;
      return opts.completeResult ?? ({ role: "assistant", content: "" } as Message);
    },
    async listModels() {
      return [];
    },
    async healthCheck() {
      return !opts.streamError && !opts.completeError;
    },
  } as Provider;
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("createFallbackProvider — stream()", () => {
  it("primary succeeds → no fallback; events from primary only", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
    });
    const fallback = fakeProvider({ name: "fb1" });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as any).content, "ok");
    assert.equal(wrapped.activeFallback, null);
  });

  it("primary fails pre-stream with 429 → falls to first fallback", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamError: new Error("429 Too Many Requests"),
    });
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "from fb1" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as any).content, "from fb1");
    assert.equal(wrapped.activeFallback, "fb1");
  });

  it("primary fails with 401 → propagates, no fallback attempted", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamError: new Error("401 Unauthorized"),
    });
    const fbStreamedEvents: StreamEvent[] = [];
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "SHOULD NOT SEE" } as StreamEvent],
    });
    // Capture whether fallback was called by observing events — if fallback ran, we'd see its event.
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    await assert.rejects(
      () => drain(wrapped.stream([], "sys", [], "m")),
      /401 Unauthorized/,
    );
    void fbStreamedEvents;
  });

  it("primary fails mid-stream → error propagates (no fallback)", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamEvents: [{ type: "text_delta", content: "partial" } as StreamEvent],
      streamError: new Error("429 mid-stream"),
      streamErrorAfterEvents: 1,
    });
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "FALLBACK SHOULD NOT RUN" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events: StreamEvent[] = [];
    try {
      for await (const e of wrapped.stream([], "sys", [], "m")) {
        events.push(e as StreamEvent);
      }
      assert.fail("expected mid-stream error to throw");
    } catch (err) {
      assert.match((err as Error).message, /mid-stream/i);
    }
    assert.equal(events.length, 1);
    assert.equal((events[0] as any).content, "partial");
  });

  it("primary fails + first fallback fails + second fallback succeeds → events from second fallback", async () => {
    const primary = fakeProvider({ name: "primary", streamError: new Error("503 Service Unavailable") });
    const fb1 = fakeProvider({ name: "fb1", streamError: new Error("timeout") });
    const fb2 = fakeProvider({
      name: "fb2",
      streamEvents: [{ type: "text_delta", content: "from fb2" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fb1 }, { provider: fb2 }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as any).content, "from fb2");
    assert.equal(wrapped.activeFallback, "fb2");
  });

  it("all providers fail → throws 'All providers failed'", async () => {
    const primary = fakeProvider({ name: "primary", streamError: new Error("429") });
    const fb1 = fakeProvider({ name: "fb1", streamError: new Error("rate limit") });
    const wrapped = createFallbackProvider(primary, [{ provider: fb1 }]);

    await assert.rejects(
      () => drain(wrapped.stream([], "sys", [], "m")),
      /All providers failed/,
    );
  });
});

describe("createFallbackProvider — complete()", () => {
  it("primary fails retriable → fallback.complete() result returned", async () => {
    const primary = fakeProvider({ name: "primary", completeError: new Error("429") });
    const fbResult = { role: "assistant", content: "from fb" } as Message;
    const fallback = fakeProvider({ name: "fb1", completeResult: fbResult });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const result = await wrapped.complete([], "sys", [], "m");
    assert.equal(result.content, "from fb");
    assert.equal(wrapped.activeFallback, "fb1");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx tsx --test src/providers/fallback.test.ts
```

Expected: 7/7 pass. The `createFallbackProvider` function is already shipped and correct; these tests validate it (and catch any regressions from the Task 2 `console.warn` addition).

- [ ] **Step 3: Full typecheck + suite**

```bash
npx tsc --noEmit
npm test
```

Expected: tsc clean. Full suite grows by 7 (baseline after hooks #32 + model-router #33 merges will vary; just confirm +7).

- [ ] **Step 4: Commit**

```bash
git add src/providers/fallback.test.ts
git commit -m "test(providers): unit coverage for createFallbackProvider"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 2: Add `console.warn` on fallback activation

**Files:**
- Modify: `src/providers/fallback.ts`
- Modify: `src/providers/fallback.test.ts` — add one test for the warn

- [ ] **Step 1: Write the failing test**

Append to `src/providers/fallback.test.ts`:

```ts
describe("createFallbackProvider — observability", () => {
  it("emits console.warn when a fallback activates on stream()", async () => {
    const original = console.warn;
    const warns: string[] = [];
    console.warn = (msg: string) => {
      warns.push(String(msg));
    };
    try {
      const primary = fakeProvider({ name: "primary", streamError: new Error("429") });
      const fb1 = fakeProvider({
        name: "fb1",
        streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
      });
      const wrapped = createFallbackProvider(primary, [{ provider: fb1 }]);
      await drain(wrapped.stream([], "sys", [], "m"));
      assert.equal(warns.length, 1);
      assert.match(warns[0]!, /fell back from primary to fb1/i);
    } finally {
      console.warn = original;
    }
  });

  it("does NOT emit console.warn when primary succeeds", async () => {
    const original = console.warn;
    const warns: string[] = [];
    console.warn = (msg: string) => {
      warns.push(String(msg));
    };
    try {
      const primary = fakeProvider({
        name: "primary",
        streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
      });
      const fb1 = fakeProvider({ name: "fb1" });
      const wrapped = createFallbackProvider(primary, [{ provider: fb1 }]);
      await drain(wrapped.stream([], "sys", [], "m"));
      assert.equal(warns.length, 0);
    } finally {
      console.warn = original;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/providers/fallback.test.ts
```

Expected: the "emits console.warn" test FAILS — no warn emitted today.

- [ ] **Step 3: Modify `src/providers/fallback.ts`**

In the existing `stream()` method's `for` loop, find the success path:

```ts
      for await (const event of p.provider.stream(messages, systemPrompt, tools, p.model)) {
        _hasYielded = true;
        yield event;
      }
      _activeFallback = i === 0 ? null : p.provider.name;
      return;
```

Replace with:

```ts
      for await (const event of p.provider.stream(messages, systemPrompt, tools, p.model)) {
        _hasYielded = true;
        yield event;
      }
      if (i > 0) {
        console.warn(`[provider] fell back from ${primary.name} to ${p.provider.name}`);
        _activeFallback = p.provider.name;
      } else {
        _activeFallback = null;
      }
      return;
```

In the `complete()` method's success path, apply the same pattern:

```ts
          const result = await p.provider.complete(messages, systemPrompt, tools, p.model);
          if (i > 0) {
            console.warn(`[provider] fell back from ${primary.name} to ${p.provider.name}`);
            _activeFallback = p.provider.name;
          } else {
            _activeFallback = null;
          }
          return result;
```

No other changes to fallback.ts.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/providers/fallback.test.ts
```

Expected: 9/9 pass (7 from Task 1 + 2 new).

- [ ] **Step 5: Full typecheck + suite**

```bash
npx tsc --noEmit
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/providers/fallback.ts src/providers/fallback.test.ts
git commit -m "feat(providers): console.warn on fallback activation"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 3: Wire `createFallbackProvider` into `createProvider`

**Files:**
- Modify: `src/providers/index.ts`

- [ ] **Step 1: Read the current `createProvider`**

Read `src/providers/index.ts` lines 15-42 to confirm the current shape. You'll modify the body between the `createProviderInstance(...)` call and the `return`.

- [ ] **Step 2: Add imports**

At the top of `src/providers/index.ts`, add:

```ts
import { readOhConfig } from "../harness/config.js";
import { createFallbackProvider, type FallbackConfig } from "./fallback.js";
```

- [ ] **Step 3: Modify the factory body**

Find:

```ts
  const provider = createProviderInstance(providerName, config);
  return { provider, model };
```

Replace with:

```ts
  const primary = createProviderInstance(providerName, config);

  const fallbackCfgs = readOhConfig()?.fallbackProviders ?? [];
  if (fallbackCfgs.length === 0) {
    return { provider: primary, model };
  }

  const fallbacks: FallbackConfig[] = fallbackCfgs.map((fb) => ({
    provider: createProviderInstance(fb.provider, {
      name: fb.provider,
      apiKey: fb.apiKey ?? process.env[`${fb.provider.toUpperCase()}_API_KEY`],
      baseUrl: fb.baseUrl,
      defaultModel: fb.model ?? model,
    }),
    model: fb.model,
  }));

  const wrapped = createFallbackProvider(primary, fallbacks);
  return { provider: wrapped, model };
```

- [ ] **Step 4: Full typecheck + suite**

```bash
npx tsc --noEmit
npm test
```

Expected: tsc clean. All existing tests pass. Users without `fallbackProviders:` see no change.

- [ ] **Step 5: Commit**

```bash
git add src/providers/index.ts
git commit -m "feat(providers): wire createFallbackProvider into createProvider factory"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 4: Factory wiring tests

**Files:**
- Create or modify: `src/providers/index.test.ts`

- [ ] **Step 1: Check if the file exists**

```bash
ls src/providers/index.test.ts 2>&1
```

If it exists, read it to match its style. If not, create it.

- [ ] **Step 2: Write the tests**

Append (or create with) these tests:

```ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import { invalidateConfigCache } from "../harness/config.js";
import { createProvider } from "./index.js";

async function withConfig(yaml: string, fn: () => Promise<void>): Promise<void> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    mkdirSync(`${dir}/.oh`, { recursive: true });
    writeFileSync(`${dir}/.oh/config.yaml`, yaml);
    invalidateConfigCache();
    await fn();
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

describe("createProvider factory — fallback wiring", () => {
  it("no fallbackProviders config → returns raw primary (no activeFallback property)", async () => {
    await withConfig(
      ["provider: ollama", "model: llama3", "permissionMode: ask", ""].join("\n"),
      async () => {
        const { provider } = await createProvider("ollama/llama3");
        // Raw primary does not expose activeFallback
        assert.equal((provider as any).activeFallback, undefined);
      },
    );
  });

  it("fallbackProviders configured → returns a wrapped provider with activeFallback getter", async () => {
    await withConfig(
      [
        "provider: ollama",
        "model: llama3",
        "permissionMode: ask",
        "fallbackProviders:",
        "  - provider: ollama",
        "    model: llama2",
        "",
      ].join("\n"),
      async () => {
        const { provider } = await createProvider("ollama/llama3");
        assert.equal(typeof (provider as any).activeFallback, "object");
        // activeFallback is null initially (no request has happened yet)
        assert.equal((provider as any).activeFallback, null);
      },
    );
  });
});
```

**Note:** the "activeFallback is null initially" check uses `typeof === "object"` because `null` is typeof `"object"` in JavaScript. This is the cleanest way to detect "the getter exists and returned null" vs "the property doesn't exist at all" (the latter returns `typeof === "undefined"`).

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx tsx --test src/providers/index.test.ts
```

- [ ] **Step 4: Full typecheck + suite**

```bash
npx tsc --noEmit
npm test
```

Expected: +2 tests. If `createProviderInstance` can't instantiate `ollama` without the Ollama server actually running (network call), use a different provider string that doesn't network on construction. `"mock"` if it exists, else `"openai"` with a dummy key (the constructor typically accepts any key without calling out). Adapt.

- [ ] **Step 5: Commit**

```bash
git add src/providers/index.test.ts
git commit -m "test(providers): factory wraps primary with fallback when configured"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 5: Docs

**Files:**
- Modify: `docs/configuration.md` — add `## Fallback providers` section
- Modify: `CHANGELOG.md` — append entry to existing Unreleased

- [ ] **Step 1: Add the docs section**

Append to `docs/configuration.md` (after the Model router section added by the previous PR):

```markdown
## Fallback providers

Configure backup providers that kick in when the primary fails:

​```yaml
provider: anthropic
model: claude-sonnet-4-6
apiKey: ${ANTHROPIC_API_KEY}
fallbackProviders:
  - provider: openai
    model: gpt-4o-mini
    apiKey: ${OPENAI_API_KEY}
  - provider: ollama
    model: llama3
    baseUrl: http://localhost:11434
​```

The primary (`provider` + `model`) is tried first. On a retriable failure before streaming begins, each fallback is tried in order.

### Retriable errors

| Trigger | Retriable? |
|---|---|
| `429 Too Many Requests` / rate limit | Yes |
| `503` / `529` / `overloaded` / service unavailable | Yes |
| Network error / timeout / `ECONNREFUSED` | Yes |
| `401` / `403` (auth failure) | **No** (different providers use different keys) |
| Any error mid-stream (after the first event is yielded) | **No** (partial output can't be un-sent) |

### Observability

When a fallback activates, openHarness prints one line to stderr: `[provider] fell back from <primary> to <fallback>`. The wrapped provider exposes a live `activeFallback` getter for programmatic access.

### Known limitations

- Mid-stream fallback (buffer partial output, re-stream on retriable error) is not supported.
- Retries on the same provider with exponential backoff are not implemented — each provider in the chain is tried exactly once before moving to the next.
- `401` / `403` failures are NOT treated as retriable because different providers use different API keys. Fix the key in your config rather than relying on fallback.
```

(Use REAL triple backticks in the file — strip the zero-width space markers above.)

- [ ] **Step 2: CHANGELOG entry**

In `CHANGELOG.md`, find the existing `## Unreleased → ### Added` section (from the hooks + model-router PRs). Append:

```markdown
- Wired the existing `createFallbackProvider` into `createProvider()`. Configure `fallbackProviders:` in `.oh/config.yaml` as an array of `{provider, model?, apiKey?, baseUrl?}`; the primary is tried first, each fallback in order on retriable failure (429/5xx/network/timeout). Auth failures (401/403) and mid-stream errors do not trigger fallback. `console.warn` emitted on fallback activation. Includes 9 new unit tests for `createFallbackProvider` (previously untested).
```

- [ ] **Step 3: Commit**

```bash
git add docs/configuration.md CHANGELOG.md
git commit -m "docs: fallback providers configuration + retriable-error table"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 6: v2.13.0 release prep (conditional — only after #33 merges)

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**IMPORTANT:** only run this task AFTER model-router PR #33 has merged to main. If #33 is still open, skip Task 6 and leave the PR at HEAD-of-feature. When #33 merges, a small follow-up commit on this branch (or a fresh "chore: release v2.13.0" PR from main) lands the bump.

- [ ] **Step 1: Pre-flight verification**

```bash
npx tsc --noEmit
npm run lint
npm test
```

All three must succeed. If any fails, STOP and report BLOCKED.

- [ ] **Step 2: Bump version**

Edit `package.json`:

```diff
-  "version": "2.12.0",
+  "version": "2.13.0",
```

- [ ] **Step 3: Finalize changelog**

In `CHANGELOG.md`, replace the `## Unreleased` header with:

```markdown
## 2.13.0 (2026-04-19) — Additional Hooks + ModelRouter + Fallback Providers
```

Keep the Added / Changed content unchanged below the new heading.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v2.13.0 — hooks + model router + fallback providers"
```

Commit footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

- [ ] **Step 5: DO NOT push, tag, or publish**

User-controlled: push → tag → CI publish, same as v2.11.0 / v2.12.0.

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| §1 Dependency & module boundary | 3 |
| §2 `createProvider` factory change | 3 |
| §3 `installFallbackObserver` (moved into fallback.ts itself) | 2 |
| §4 Tests | 1, 2, 4 |
| §5 Error taxonomy (no new types) | Inherited from existing class |
| §6 Docs | 5 |
| Release prep | 6 (conditional) |

All spec requirements covered.

### Placeholder scan

- Task 4 Step 4 notes a conditional: "If `ollama` doesn't work without a running server, use a different provider." Acceptable — explicit fallback with concrete alternative (`"openai"` with dummy key).
- Task 6 is explicitly gated on #33 merging — acceptable conditional, not a TBD.
- No "handle edge cases" / "TODO" / "implement later" anywhere.

### Type consistency

- `FallbackConfig`, `Provider` — imported consistently.
- `fakeProvider` helper in Task 1 reused in Task 2 (same test file).
- `createFallbackProvider` signature stable across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-fallback-providers-wiring.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration.
2. **Inline Execution** — batch in this session with checkpoints.

Which approach?
