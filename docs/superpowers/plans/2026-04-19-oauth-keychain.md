# OAuth Keychain Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OS keychain as the primary storage backend for MCP OAuth tokens, with filesystem as automatic fallback.

**Architecture:** New `oauth-keychain.ts` wraps `@napi-rs/keyring`. `oauth-storage.ts` becomes a thin switchboard that tries keychain first and falls back to the existing filesystem helpers (renamed to `oauth-storage-fs.ts`). Config `credentials.storage: "filesystem"` forces filesystem.

**Tech Stack:** TypeScript, `@napi-rs/keyring` (optional dep), Node `node:test`.

**Source spec:** `docs/superpowers/specs/2026-04-19-oauth-keychain-design.md`

---

## Tasks

### Task 1: Install optional dep + rename filesystem module

1. `npm install --save-optional @napi-rs/keyring`
2. Rename `src/mcp/oauth-storage.ts` → `src/mcp/oauth-storage-fs.ts` (pure filesystem helpers stay as-is).
3. Rename `src/mcp/oauth-storage.test.ts` → `src/mcp/oauth-storage-fs.test.ts` and update the import path inside the test file.
4. `npx tsc --noEmit` + `npm test` — expect tests to still pass with the new name.
5. Commit: `deps: add @napi-rs/keyring (optional) + rename filesystem storage module`

### Task 2: Implement `oauth-keychain.ts`

1. Create `src/mcp/oauth-keychain.ts` with `keychainAvailable`, `saveCredentialsKeychain`, `loadCredentialsKeychain`, `deleteCredentialsKeychain`, and a `_resetForTesting` helper that clears the internal cache.
2. Create `src/mcp/oauth-keychain.test.ts` with 4 tests:
   - Save+load round-trip (mock `@napi-rs/keyring` Entry class with an in-memory map).
   - Load-miss returns undefined.
   - Module-load failure (throw inside `require`) returns false/undefined from all three functions.
   - Delete idempotent when entry doesn't exist.
3. `npx tsx --test src/mcp/oauth-keychain.test.ts` → 4 pass. `npm test` → full suite growth.
4. Commit: `feat(mcp): oauth-keychain.ts (napi-rs/keyring wrapper)`

### Task 3: Build the orchestrator + config field

1. Create a new `src/mcp/oauth-storage.ts` (orchestrator, as in the spec's § 3).
2. Add `credentials?: { storage?: "filesystem" | "auto" }` to `OhConfig` in `src/harness/config.ts`.
3. Add 3 tests to `oauth-storage.test.ts` (re-create the file if it was renamed out in Task 1):
   - `credentials.storage: "filesystem"` config bypasses keychain.
   - Default save goes to keychain when available.
   - Load prefers keychain when both have entries.
4. Verify all existing callers of the OLD `oauth-storage` still work via the new public API (no signature change).
5. Commit: `feat(mcp): keychain-first token storage with filesystem fallback`

### Task 4: Docs + CHANGELOG

1. Rewrite the Token Storage section in `docs/mcp-servers.md` (~15 lines — describe keychain-first behavior, fallback, opt-out).
2. Add Unreleased entry to `CHANGELOG.md`.
3. Commit: `docs: keychain-first OAuth token storage`

### Task 5: Release prep (defer until #35 + #36 merged)

Conditional. If session polish (#35) and first-run wizard (#36) have both landed:
1. Bump `package.json` `2.13.0` → `2.14.0`.
2. Replace `## Unreleased` with `## 2.14.0 (2026-04-XX) — Session polish + First-run wizard + Keychain storage`.
3. Commit.
4. Push tag after user approval.

---

## Verification

```bash
npx tsc --noEmit
npm run lint
npm test

# On macOS after an OAuth flow:
security find-generic-password -s openharness-mcp -a <server-name>

# On Linux with libsecret:
secret-tool search service openharness-mcp

# Force filesystem-only:
echo 'credentials: { storage: "filesystem" }' >> .oh/config.yaml
# next save should land in ~/.oh/credentials/mcp/ as before
```

## Scope boundaries

**In:** keychain primary + filesystem fallback, opt-out via config, 7 new tests.

**Out:** `oh mcp migrate` command (deferred), warning on keychain failure (silent for v1), per-server backend override, keychain for non-MCP secrets.
