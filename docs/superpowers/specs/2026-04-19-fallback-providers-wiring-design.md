# Fallback Providers Wiring — Design Spec

**Date:** 2026-04-19
**Status:** Draft
**Tier:** B (v2.13.0 — third of three features)
**Target release:** `@zhijiewang/openharness@2.13.0`

## Context

`src/providers/fallback.ts` ships a complete `createFallbackProvider` function — wraps a primary `Provider` with a chain of fallbacks that activate on pre-stream retriable errors (429/5xx/network/timeout). It's never imported outside its own file and has no tests. The `fallbackProviders?:` field already exists at `src/harness/config.ts:119`.

Same pattern as the `ModelRouter` wiring: infrastructure is built but dead. This spec wires it into `createProvider()` and adds coverage.

## Goals

1. Configure a list of fallback providers in `.oh/config.yaml` and have them activate transparently when the primary returns a retriable error before streaming begins.
2. Zero behavior change when `fallbackProviders:` is unset.
3. Add test coverage to the existing `createFallbackProvider` (none today) and the new wiring.
4. Surface fallback activation via a one-line stderr warning.

## Non-goals

- **Mid-stream fallback** (buffer partial output, re-stream on retriable mid-stream error). Intentionally deferred — matches the conservative pass-through design already shipped in the class. LiteLLM added this in 2026 via `MidStreamFallbackError`; we may follow later if a customer asks.
- **Retry with exponential backoff** on the same provider before falling. The existing class tries each provider exactly once in sequence — simpler, and transient errors typically benefit more from a different provider than a retry on the same one.
- **REPL banner / info message** on fallback activation. `console.warn` to stderr for v1; a richer surface can wire a hook later.
- **Per-tool fallback policy** (e.g. "never fallback for `Bash`"). Global for v1.
- **Circuit breaker** (stop trying a known-down provider for N minutes). Out of scope; each request starts fresh.

## Approach

Modify `createProvider()` in `src/providers/index.ts` to:
1. Instantiate the primary via existing `createProviderInstance`.
2. Read `readOhConfig()?.fallbackProviders ?? []`.
3. For each entry, construct a sub-provider with `createProviderInstance` using the entry's overrides (`apiKey`, `baseUrl`, `model`).
4. If the list is non-empty, wrap with `createFallbackProvider(primary, fallbacks)` and return the wrapped provider. Otherwise return the primary unchanged.

All 7 `createProvider` call sites in `main.tsx` are untouched — they get a provider that happens to have fallback behavior if the user configured it.

### Retriable-error set (already in the class — keeping)

| Trigger | Retriable? |
|---|---|
| `429 Too Many Requests` / rate limit | Yes |
| `503` / `529` / `overloaded` / service unavailable | Yes |
| Network error / timeout / `ECONNREFUSED` | Yes |
| `401` / `403` (auth failure) | **No** — different providers use different keys |
| Any error mid-stream (≥1 event already yielded) | **No** — partial output can't be un-sent |

Matches LiteLLM's 2026 best-practice set per research.

### Observability

When `activeFallback` transitions from null → non-null during a request, emit a one-line `console.warn`: `[provider] fell back from <primary> to <fallback>`. The provider shape already exposes `activeFallback` getter for programmatic access. Pattern matches `src/mcp/transport.ts:123`.

## Design

### 1. Dependency & module boundary

- `src/providers/index.ts` — `createProvider` factory; single wiring point. One new import (`createFallbackProvider` + types).
- `src/providers/fallback.ts` — UNCHANGED. The existing class is already correct.
- `src/harness/config.ts` — UNCHANGED. `fallbackProviders` type is already correct.
- New: `src/providers/fallback.test.ts` — unit tests for the class (~7 tests covering happy paths, retriable vs non-retriable errors, mid-stream propagation, all-fail).
- New or extend: `src/providers/index.test.ts` — 2 tests for the factory wiring (wrapped vs unwrapped).

Net new code in `src/providers/index.ts`: ~20 lines. New tests: ~150 lines.

### 2. `createProvider` factory change

Current (`src/providers/index.ts:15-42`):

```ts
export async function createProvider(
  modelArg?: string,
  overrides?: Partial<ProviderConfig>,
): Promise<{ provider: Provider; model: string }> {
  // ...resolve providerName + model...
  const config: ProviderConfig = { /* ... */ };
  const provider = createProviderInstance(providerName, config);
  return { provider, model };
}
```

Changed:

```ts
export async function createProvider(
  modelArg?: string,
  overrides?: Partial<ProviderConfig>,
): Promise<{ provider: Provider; model: string }> {
  // ...resolve providerName + model (unchanged)...
  const config: ProviderConfig = { /* ... */ };
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
  installFallbackObserver(wrapped);
  return { provider: wrapped, model };
}
```

### 3. `installFallbackObserver`

Small helper in `src/providers/index.ts`:

```ts
function installFallbackObserver(wrapped: Provider & { readonly activeFallback: string | null }): void {
  // Watch for transitions from null → non-null on activeFallback.
  // Since activeFallback is a getter, we poll-check by wrapping the stream() method.
  // Simpler: the class's own transition point (inside the try/catch in stream/complete)
  // is the right place to log. Rather than re-implement observation, add the warn
  // directly to `createFallbackProvider` in src/providers/fallback.ts.
}
```

**Revised approach:** the cleanest place to emit the warn is inside `createFallbackProvider` itself (the class, `src/providers/fallback.ts`). Modify that file to emit `console.warn` at the exact transition point where a fallback is selected. This keeps observation local to the state change and avoids polling. Minor deviation from the "don't touch fallback.ts" non-goal — the modification is a single `console.warn` line on the already-existing success-after-fallback branch.

Final shape of the fallback.ts change:

```ts
// inside createFallbackProvider's stream() loop:
for (let i = 0; i < providers.length; i++) {
  const p = providers[i]!;
  try {
    let _hasYielded = false;
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
  } catch (err) {
    // ...existing logic...
  }
}
```

Same addition in the `complete()` path. No other changes to the class.

### 4. Tests

**`src/providers/fallback.test.ts`** (new — 7 tests):

1. Primary succeeds on stream → events from primary; `activeFallback === null` after completion; no fallback instance called.
2. Primary fails pre-stream with retriable (`new Error("429 Too Many Requests")`) → falls to first fallback; fallback's events are yielded; `activeFallback === "<fallback.name>"`.
3. Primary fails pre-stream with `401` → propagates `"401 Unauthorized"` error; no fallback attempted.
4. Primary yields one event then throws retriable → error propagates (mid-stream); no fallback attempted. Assert: 1 event yielded, error matches.
5. Primary fails pre-stream + first fallback fails pre-stream + second fallback succeeds → events from second fallback.
6. All providers fail → throws `"All providers failed (primary + fallbacks)"`.
7. `complete()` path: primary fails retriable, fallback succeeds → returns fallback's result; `activeFallback === "<fallback.name>"`.

Mock `Provider` instances via a `makeFakeProvider({ streamEvents?, streamError?, completeResult?, completeError? })` helper. Match the shape used by `router-integration.test.ts`.

**`src/providers/index.test.ts`** (new or extended — 2 tests):

1. `createProvider()` with no `fallbackProviders:` in config → returned provider has NO `activeFallback` property (raw primary).
2. `createProvider()` with `fallbackProviders: [{provider: "ollama", model: "llama3"}]` → returned provider has `activeFallback` property (wrapped). Write a temp `.oh/config.yaml` for the test using `makeTmpDir` helper.

### 5. Error taxonomy

No new error types. The existing `"All providers failed (primary + fallbacks)"` message from `createFallbackProvider` is surfaced as-is. Callers wrap LLM errors in their own context (`src/query/errors.ts`).

### 6. Docs

Extend `docs/configuration.md` with the `## Fallback providers` section from the design presentation above. `CHANGELOG.md` gets an entry in the existing Unreleased block.

## Testing

- Unit tests above.
- Manual: configure `fallbackProviders: [{provider: "ollama", model: "llama3"}]` with an Anthropic primary using a deliberately invalid API key. Send a prompt. Expect stderr to say "fell back from anthropic to ollama" and the response to come from Ollama.
- Manual: with a valid primary, confirm NO fallback-activation warning appears.

## Security

- API keys in `fallbackProviders[].apiKey` are written to the sub-provider config at instantiation time. If unset, falls back to `process.env[${PROVIDER}_API_KEY]` like the primary (existing pattern).
- No new network surface beyond the existing provider instances.
- No new persistence — each request rebuilds the fallback chain fresh from config.

## Migration

Zero. Unconfigured users unaffected.

## Release

This is the THIRD of three v2.13.0 features (after hooks #32 merged and model router #33 in review). Release prep is a SEPARATE small commit that lands after the model router merges:

- Bump `package.json` `2.12.0` → `2.13.0`
- Replace `## Unreleased` with `## 2.13.0 (2026-04-19) — Additional Hooks + ModelRouter + Fallback Providers`
- Local commit only; user pushes the tag; CI workflow handles npm publish + GitHub Release.

The fallback-providers PR ships WITHOUT the version bump so it's mergeable independently of #33's timing. A follow-up "chore: release v2.13.0" commit lands after both merge.

## Open questions

- **Fallback as a QueryConfig override?** Some use cases want per-query fallback (e.g., "use ollama only for exploration, never for final response"). Not needed for v1; all requests go through the same wrapped provider.
- **Fallback-chain health-check on startup?** `createFallbackProvider` already forwards `healthCheck()` to the first healthy provider in the chain. We could extend `oh doctor` to report each fallback's health. Defer — `oh doctor` isn't touched in this PR.

## Out of scope (tracked for later)

- Mid-stream fallback with buffering (LiteLLM 2026 pattern)
- Exponential backoff + jitter on same-provider retry
- Circuit breaker (skip known-down providers for N minutes)
- Per-tool or per-query fallback policy overrides
- REPL info-message on fallback activation (currently stderr-only)
