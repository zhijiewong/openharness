# Model Router Wiring — Design Spec

**Date:** 2026-04-19
**Status:** Draft
**Tier:** B (v2.13.0 — second of three features)
**Target release:** `@zhijiewang/openharness@2.13.0`

## Context

`src/providers/router.ts` ships a complete `ModelRouter` class with heuristic-based tier selection (fast/balanced/powerful). `src/harness/config.ts:113` defines the `modelRouter?: { fast?, balanced?, powerful? }` config field. Neither is wired into the query loop — the class is imported nowhere outside its own file and the config is read nowhere.

This spec wires the existing infrastructure into the main query loop and the AgentTool sub-agent loop, and adds a single `/router` slash command for observability. No new classes, no new config schema.

## Goals

1. Let users configure distinct models per tier in `.oh/config.yaml` and have turns automatically route to the appropriate tier based on the existing heuristics.
2. Sub-agents (AgentTool invocations) route with `role` context so `powerfulRoles` (code-reviewer, evaluator, architect, security-auditor) auto-upgrade.
3. `/router` shows current tier-to-model mapping and the last selection + reason per session.
4. Zero behavior change when `modelRouter:` is unset (the existing class already falls back to `defaultModel` for every tier).

## Non-goals

- New heuristics — the existing `ModelRouter.select()` rules stand.
- Per-tool tier overrides (`toolRouting: { Bash: "fast" }`). Deferred to a later PR if customers ask.
- `/tier <fast|balanced|powerful>` user-pin slash command.
- Per-tier cost breakdown in `/cost`.

## Approach

Instantiate `ModelRouter` once at the start of each `query()` call. Before each turn, build a `RouteContext` from the query loop's existing state (turn counter, last-turn tool activity, context pressure via the existing `contextUsage` helper) and call `router.select()`. Pass the selected model to `provider.stream()` at `src/query/index.ts:208`.

Sub-agents get the same treatment plus the resolved `role` name.

Observability via a module-level `Map<sessionId, RouteResult>` that the `/router` command reads.

## Design

### 1. Query-loop integration

**File:** `src/query/index.ts`

At the top of `query()`, add:

```ts
const routerCfg = readOhConfig()?.modelRouter ?? {};
const router = new ModelRouter(routerCfg, config.model);
```

Inside the turn loop, before the `stream()` call at line 208:

```ts
const ctxUsage = estimateRouteContextUsage(state.messages, config.provider, config.model);
const selection = router.select({
  turn: state.turn,
  hadToolCalls: state.lastTurnHadTools,
  toolCallCount: state.lastTurnToolCount,
  contextUsage: ctxUsage,
  isFinalResponse: state.lastTurnHadTools === false && state.turn > 1,
  role: config.role, // undefined for main agent
});
recordRouteSelection(config.sessionId, selection);
```

Replace the stream call:

```ts
for await (const event of config.provider.stream(
  state.messages,
  turnPrompt,
  apiTools,
  selection.model, // was config.model
)) {
```

**Helpers:**
- `estimateRouteContextUsage(messages, provider, model)` — small helper that sums `provider.estimateTokens(m.content)` across messages and divides by the model's context window (use `getModelInfo(model)?.contextWindow` when available; fall back to a reasonable default). Returns a number in `[0, 1]`. Falls back to `undefined` when tokenization is unavailable.
- `recordRouteSelection(sessionId, result)` — exported from `router.ts`, writes to a module-level `Map<string, RouteResult>`. Cap size to prevent leaks in long-lived daemons (LRU 256 entries).

### 2. Sub-agent integration

**File:** `src/tools/AgentTool/index.ts`

The existing code resolves a `role` from `input.subagent_type` at line 61-76. After resolution, thread the role name into the sub-agent's query config:

```ts
for await (const event of query(input.prompt, { ...config, role: role?.name })) {
```

**File:** `src/query/index.ts` — `QueryConfig` type gains an optional `role?: string` field (used only by the router). Zero effect on other logic.

### 3. `/router` slash command

**File:** `src/commands/info.ts` — register alongside existing `/mcp`, `/cost`, etc.

```ts
register("router", "Show the model router state", (_args, ctx) => {
  const cfg = readOhConfig()?.modelRouter;
  const defaultModel = ctx.model ?? "unknown";
  if (!cfg || (!cfg.fast && !cfg.balanced && !cfg.powerful)) {
    return { output: `Router: off (single model: ${defaultModel})`, handled: true };
  }
  const last = getRouteSelection(ctx.sessionId);
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

The `ctx.model` and `ctx.sessionId` fields are already in `CommandContext` (used by existing `/mcp`, `/cost`).

### 4. Tests

- **`src/providers/router.test.ts`** (existing) — unchanged; verifies select() heuristics.
- **`src/query/router-integration.test.ts`** (new) — construct a `query()` with a fake provider that records the `model` argument of each `stream()` call. Feed a 3-turn message sequence. Configure a router with distinct fast/balanced/powerful models. Assert the recorded models match the heuristic-expected sequence (e.g. `fast` on tool-heavy turn 1, `balanced` on turn 2, `powerful` on final). Also test the unconfigured case: all calls use `config.model`.
- **`src/tools/AgentTool/index.test.ts`** (extend existing if present; else new) — dispatch a `code-reviewer` sub-agent, observe the model arg to `stream()` is the `powerful` tier.
- **`src/commands/commands-new.test.ts`** (extend) — `/router` output in the unconfigured state (`"off"`), configured-no-history state (three-tier listing, no `Last selection`), and configured-with-history state (three-tier listing + last selection line).

### 5. Error and edge cases

- Router config fully empty (`modelRouter: {}`) → `isConfigured === false` → every `select()` returns `defaultModel`. No recorded selection entry (keeps `/router` output as "off").
- Invalid model string in a tier → passed through to the provider as-is; the provider's own validation surfaces the error. No router-side validation.
- Provider without `estimateTokens` → `contextUsage` is `undefined`; the router's context-pressure heuristic becomes a no-op. Remaining heuristics still apply.
- Sub-agent with unknown `role` → `role` stays undefined; router uses non-role heuristics. No error.

### 6. Telemetry (optional, deferred)

Emitting a `modelSwitch` telemetry event on tier change would be low-cost. `src/harness/telemetry.ts` exists as the hook for it, but the default telemetry mode is off. Skip for v1; revisit if customers ask.

## Testing

- Unit: the four test files above; existing `router.test.ts` passes unchanged.
- Integration: router-integration.test.ts replaces the need for a manual-only test — it verifies end-to-end behavior against a fake provider.
- Smoke: with a real `modelRouter:` config set in `.oh/config.yaml`, run `oh` interactively; confirm `/router` shows the config and `/router` after a turn shows a `Last selection` line.

## Documentation

- Extend `docs/configuration.md` (or create `docs/model-router.md`) with the `modelRouter` schema + heuristic summary (context > 80% → fast; `powerfulRoles` sub-agents → powerful; tool-heavy turn → fast; final response → powerful; default → balanced).
- `CHANGELOG.md` unreleased entry: "Wired the existing `ModelRouter` into the query loop. `/router` slash command added."
- README link from the MCP/hooks section to the new router doc if appropriate.

## Migration

Zero. Unconfigured users see no change; configured users immediately benefit.

## Release

No version bump in this PR. Batched with the in-flight hook events PR (#32) and the upcoming fallback providers PR; v2.13.0 lands when the last of the three merges.

## Open questions / minor

- **`RouteContext.isFinalResponse`** — we can only infer this AFTER seeing whether the turn had tool calls. The router's heuristic is evaluated BEFORE the turn. Proposed: use `state.lastTurnHadTools === false && state.turn > 1` (i.e., previous turn was a text-only response) as a proxy. Acceptable heuristic — the router's role is opportunistic cost/latency savings, not correctness.
- **Config reload during a session** — if the user edits `.oh/config.yaml` mid-session, does the router pick up the change? The `configChange` hook invalidates the config cache. Query loops instantiate the router at `query()` entry, so a mid-session edit takes effect starting the next user turn. Good enough; document.

## Out of scope (tracked for later)

- Per-tool tier overrides in config
- `/tier <name>` user-pin slash command
- `/cost` per-tier breakdown
- `modelSwitch` telemetry event
- Model-capability-aware routing (e.g., prefer a vision-capable tier when an image is in context)
