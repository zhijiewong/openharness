# Tier 1 Bug Fixes — Design Spec

**Date:** 2026-04-04
**Scope:** 8 correctness/polish fixes, shipped as a single PR

---

## 1. `compressMessages` Orphan Tool Results

**File:** `src/query.ts`

**Problem:** When `/compact` drops old messages by index, it can drop an assistant message that has `toolCalls` while retaining its corresponding `tool` result messages (or vice versa). Anthropic's API requires tool results to immediately follow the assistant message that issued the tool call — orphaned results cause a 400 error.

**Fix:** Before dropping any assistant message that has `toolCalls`, also drop all `tool` result messages whose `toolResults[].callId` matches any of the assistant's `toolCalls[].id`. Likewise, if dropping a `tool` result message, drop the preceding assistant message that issued the call. Apply this as a post-pass after the existing keep-last-N logic: scan the compacted array, identify any orphaned tool results (no preceding assistant with matching toolCall id), and remove them.

---

## 2. `WebFetchTool` Redirect Blocking

**File:** `src/tools/WebFetchTool/index.ts`

**Problem:** `redirect: "error"` blocks all redirects including legitimate HTTPS upgrades (e.g. `http://github.com` → `https://github.com`), making the tool fail on most real-world URLs.

**Fix:**
1. Change `redirect: "error"` → `redirect: "follow"`
2. After the fetch completes, extract the final URL from `response.url`
3. Re-run `isBlockedHost` on the final URL's hostname to prevent SSRF via open redirects

---

## 3. Sub-agent `permissionMode` Inheritance

**File:** `src/tools/AgentTool/index.ts`

**Problem:** Sub-agents always run with `permissionMode: "trust"` regardless of the parent session's permission mode. A parent running in `deny` mode can be bypassed by any tool call that goes through AgentTool.

**Fix:** Pass the parent's `permissionMode` from the tool execution context into the sub-agent's `QueryConfig`. The `AgentTool` receives context (including `permissionMode`) via its execution parameters — thread it through to the sub-agent query.

---

## 4. `loadCybergotchiConfig()` Disk Reads on Every Render

**File:** `src/components/REPL.tsx`

**Problem:** `loadCybergotchiConfig()` reads and parses a JSON file from disk. It is called on every Ink render (at minimum twice per render: once for the setup gate check, twice in the keybinding hint). During active streaming sessions, Ink re-renders many times per second.

**Fix:**
1. Load config once on mount into a `useRef`: `const cybergotchiConfigRef = useRef(loadCybergotchiConfig())`
2. After any operation that saves config (cybergotchi setup completion), update the ref: `cybergotchiConfigRef.current = loadCybergotchiConfig()`
3. Replace all inline `loadCybergotchiConfig()` calls in the render path with `cybergotchiConfigRef.current`

---

## 5. Duplicate Context Window Tables

**Files:** `src/query.ts`, `src/harness/cost.ts`

**Problem:** Two separate hardcoded lookup tables map model names to context window sizes. They use different matching strategies (prefix-based in `query.ts`, exact in `cost.ts`) and have diverged — models added to one are missing from the other.

**Fix:**
1. In `cost.ts`, consolidate into a single exported `MODEL_CONTEXT_WINDOWS` map with all known models
2. Export a `getContextWindow(model: string): number` helper that does prefix-based matching (to handle versioned model names) with a sensible default (8192)
3. In `query.ts`, delete `getContextWindow` and import from `cost.ts`

---

## 6. 429 Rate-Limit Retry with Backoff

**File:** `src/query.ts`

**Problem:** HTTP 429 responses are treated the same as any other error — the session stops and the user must manually retry.

**Fix:**
1. Add a new stream event type: `{ type: "rate_limited"; retryIn: number; attempt: number }`
2. In the query loop, wrap `provider.stream()` in a retry loop (max 3 attempts)
3. On 429 (detected from the error message or a new `isRateLimitError` helper): emit `rate_limited` event, wait `2^attempt * 1000ms` (2s, 4s, 8s), then retry
4. In `REPL.tsx`, handle the `rate_limited` event: display "⏳ Rate limited — retrying in Xs…" in the spinner area using existing `streamingText` state
5. If all 3 attempts fail, surface as a normal error

**Retry delays:** 2s → 4s → 8s (exponential, no jitter needed for a CLI tool)

---

## 7. `llamacpp` in `guessProviderFromModel`

**File:** `src/providers/index.ts`

**Problem:** `guessProviderFromModel` doesn't recognise `llamacpp` model names, so users always need the `llamacpp/` prefix.

**Fix:** Add detection before the default fallback:
```ts
if (model.includes("gguf") || model.startsWith("llamacpp")) return "llamacpp";
```

---

## 8. Verify Issue #9 — `oh models` baseUrl for Ollama

**File:** `src/commands/index.ts` or wherever `oh models` is implemented

**Action:** Read the current `models` command implementation. If Ollama already shows its baseUrl (commit `584c698` may have fixed this), close the GitHub issue. If not, add the baseUrl display consistent with how `llamacpp` shows it.

---

## Delivery

- Single PR targeting `main`
- PR description lists all 8 fixes with one-line summaries
- `npm run build` must pass
- Manual smoke test: run `oh --model ollama/llama3`, verify no regressions in startup, `/compact`, WebFetch, and sub-agent tool calls
