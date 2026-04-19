# OAuth Token Storage: OS Keychain Backend — Design Spec

**Date:** 2026-04-19
**Status:** Draft
**Tier:** B (v2.14.0 candidate)
**Target release:** batched with session polish (#35) + first-run wizard (#36)

## Context

v2.12.0 shipped OAuth 2.1 for remote MCP with **filesystem-only** token storage at `~/.oh/credentials/mcp/<name>.json` (mode `0600`). The spec explicitly deferred OS-keychain storage as a future enhancement. Filesystem is portable but vulnerable to local filesystem theft; users with higher security requirements expect OS-native credential storage (macOS Keychain / Windows Credential Manager / Linux Secret Service).

This spec adds keychain as the **primary** backend while keeping filesystem as automatic fallback. Zero migration burden — existing filesystem tokens continue to load and will migrate naturally on next write.

## Goals

1. Use the OS keychain by default for MCP OAuth tokens when available.
2. Fall back to the existing filesystem store transparently when the keychain isn't usable (headless Linux without libsecret, containers, module-load failure).
3. Allow users to opt out of keychain storage via `credentials.storage: "filesystem"` in `.oh/config.yaml`.
4. Keep the existing `saveCredentials`/`loadCredentials`/`deleteCredentials` API surface — callers in `src/mcp/oauth.ts` are untouched.

## Non-goals

- **Migration command** (`oh mcp migrate`) — deferred. Existing filesystem tokens keep working as fallback and will migrate organically on next save.
- **Per-server backend override** (e.g. "keychain for Linear, filesystem for self-hosted"). Global for v1.
- **Encrypting the filesystem fallback at rest**. Existing 0600 mode is the guarantee.
- **Keyring for API keys or other secrets beyond MCP OAuth**. Scope is MCP tokens only.

## Approach

Add `@napi-rs/keyring` as an **optional** dependency. It's a Rust-backed N-API wrapper with pre-built binaries for macOS/Windows/Linux — avoids the libsecret/dbus-on-WSL issues that plague `keytar` (now deprecated). Microsoft migrated MSAL to this library in 2024.

Token storage becomes a small switchboard:

1. Keychain tried first (iff the module loads AND `credentials.storage !== "filesystem"`).
2. Filesystem fallback on keychain failure (module load error, dbus unavailable, `Entry.setPassword` throws).
3. Reads check keychain first, then filesystem. If both have entries (e.g. mid-migration), keychain wins.
4. Deletes remove from both locations.

Keychain entry shape: service = `"openharness-mcp"`, account = `<server-name>`, password = JSON-serialized `OhCredentials`. All three platforms accept arbitrarily-long values for Generic Password entries.

## Design

### 1. File structure

- **New** `src/mcp/oauth-keychain.ts` (~80 LOC) — same three function signatures as `oauth-storage-fs.ts`, backed by `@napi-rs/keyring`'s `Entry` API. Every function catches all errors and returns `undefined`/false; never throws.
- **Rename** `src/mcp/oauth-storage.ts` → `src/mcp/oauth-storage-fs.ts`. The pure filesystem helpers move there.
- **New** `src/mcp/oauth-storage.ts` (~60 LOC) — orchestrator. Each of the three exports tries keychain first (iff available), falls back to filesystem, respects the config opt-out.
- **Modify** `src/harness/config.ts` — add optional `credentials?: { storage?: "filesystem" | "auto" }` field on `OhConfig`.
- **Modify** `package.json` — add `@napi-rs/keyring` to `optionalDependencies`.
- **Modify** `docs/mcp-servers.md` — rewrite Token Storage section.
- **Modify** `CHANGELOG.md` — Unreleased entry.

Why the `-fs` rename: preserves the existing API shape for filesystem callers that might exist outside `oauth-storage.ts` (e.g. tests), while the new `oauth-storage.ts` becomes the single external entry point.

### 2. Keychain module

```ts
// src/mcp/oauth-keychain.ts
import type { OhCredentials } from "./oauth-storage-fs.js";

const SERVICE = "openharness-mcp";

/** Lazily loads the keyring module. Returns null if unavailable. */
let entryCtor: (new (service: string, account: string) => KeyringEntry) | null | undefined;
function getEntryCtor(): (new (service: string, account: string) => KeyringEntry) | null {
  if (entryCtor !== undefined) return entryCtor;
  try {
    const mod = require("@napi-rs/keyring");
    entryCtor = mod.Entry;
    return entryCtor;
  } catch {
    entryCtor = null;
    return null;
  }
}

interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export function keychainAvailable(): boolean {
  return getEntryCtor() !== null;
}

export function saveCredentialsKeychain(name: string, creds: OhCredentials): boolean {
  const Ctor = getEntryCtor();
  if (!Ctor) return false;
  try {
    new Ctor(SERVICE, name).setPassword(JSON.stringify(creds));
    return true;
  } catch {
    return false;
  }
}

export function loadCredentialsKeychain(name: string): OhCredentials | undefined {
  const Ctor = getEntryCtor();
  if (!Ctor) return undefined;
  try {
    const raw = new Ctor(SERVICE, name).getPassword();
    if (!raw) return undefined;
    return JSON.parse(raw) as OhCredentials;
  } catch {
    return undefined;
  }
}

export function deleteCredentialsKeychain(name: string): boolean {
  const Ctor = getEntryCtor();
  if (!Ctor) return false;
  try {
    new Ctor(SERVICE, name).deletePassword();
    return true;
  } catch {
    return false;
  }
}
```

### 3. Orchestrator

```ts
// src/mcp/oauth-storage.ts
import { readOhConfig } from "../harness/config.js";
import {
  deleteCredentials as deleteFs,
  loadCredentials as loadFs,
  saveCredentials as saveFs,
  type OhCredentials,
} from "./oauth-storage-fs.js";
import {
  deleteCredentialsKeychain,
  keychainAvailable,
  loadCredentialsKeychain,
  saveCredentialsKeychain,
} from "./oauth-keychain.js";

export type { OhCredentials } from "./oauth-storage-fs.js";

function useKeychain(): boolean {
  const cfg = readOhConfig();
  if (cfg?.credentials?.storage === "filesystem") return false;
  return keychainAvailable();
}

export async function saveCredentials(storageDir: string, name: string, creds: OhCredentials): Promise<void> {
  if (useKeychain() && saveCredentialsKeychain(name, creds)) return;
  await saveFs(storageDir, name, creds);
}

export async function loadCredentials(storageDir: string, name: string): Promise<OhCredentials | undefined> {
  if (useKeychain()) {
    const fromKc = loadCredentialsKeychain(name);
    if (fromKc) return fromKc;
  }
  return loadFs(storageDir, name);
}

export async function deleteCredentials(storageDir: string, name: string): Promise<void> {
  if (useKeychain()) deleteCredentialsKeychain(name);
  await deleteFs(storageDir, name);
}
```

### 4. Tests

- **`src/mcp/oauth-keychain.test.ts`** (new) — 4 tests using a monkey-patched `require` or direct module-level mock for `@napi-rs/keyring`. Covers round-trip, load-miss, module-load failure swallowed, delete idempotence. The "module-load failure" test needs `getEntryCtor`'s cache reset between tests — expose an internal `_resetForTesting()` helper.

- **`src/mcp/oauth-storage.test.ts`** (extend existing) — 3 new tests:
  - `credentials.storage: "filesystem"` in config bypasses keychain even when available (mock keychain as available, assert filesystem is used).
  - Save prefers keychain when available; filesystem file NOT created.
  - Load prefers keychain over filesystem when both have entries.

- Existing tests in `oauth-storage.test.ts` move to `oauth-storage-fs.test.ts` (rename file to match the source rename), or stay and get augmented — choose based on what disturbs less.

### 5. Config

```ts
// src/harness/config.ts — add to OhConfig
credentials?: {
  /** Where to store MCP OAuth tokens. Default: "auto" (keychain if available, filesystem otherwise). */
  storage?: "filesystem" | "auto";
};
```

No normalization needed — unset / invalid values fall through to default behavior.

### 6. Error modes

All keychain errors are swallowed and return the "unavailable" sentinel (undefined / false). Rationale: the OS prompt for keychain access can fail for many benign reasons (user cancelled, screen locked, no D-Bus session). A noisy failure here would block OAuth for no reason; silent fallback to filesystem matches user expectation.

One failure mode worth surfacing: on first save when keychain appears available but `setPassword` throws (e.g. user hits Cancel on the macOS prompt). Today's plan: silent fallback — save goes to filesystem, user never sees the keychain prompt again for that token. If users complain, v2.15 can add a single-line stderr warning.

## Testing

- Unit: the 7 new tests above.
- Smoke (manual):
  - macOS: run `oh` with `type: http` MCP server that needs auth. Complete OAuth flow. Verify `security find-generic-password -s openharness-mcp -a <name>` returns the JSON blob.
  - Linux (libsecret installed): same flow. Verify `secret-tool search service openharness-mcp` returns the entry.
  - Linux (headless, no D-Bus): same flow. Verify token lands in `~/.oh/credentials/mcp/<name>.json` as today.
  - Any platform with `credentials: { storage: "filesystem" }` in config: verify filesystem is used even if keychain would work.

## Security

- Same 0600 mode guarantee on the filesystem fallback.
- Keychain entries inherit OS-level per-user isolation (macOS Keychain ACLs, Windows DPAPI, Linux Secret Service sandbox).
- Service name `openharness-mcp` is distinct from other OH secrets, allowing targeted wipe (`security delete-generic-password -s openharness-mcp` on macOS).
- No telemetry, no remote backup — matches existing OH privacy stance.

## Migration

Zero. First read after upgrade: filesystem file exists, keychain empty → filesystem wins, no change. Next save: keychain picks it up. The filesystem file is not auto-deleted (gives users a recovery path); future `oh mcp migrate` command can clean it up.

## Release

Batched into v2.14.0 after #35 (session polish), #36 (first-run wizard), and this PR all merge. Version bump in a tiny release-prep commit.

## Open questions

- **Should the filesystem fallback warn when it triggers after keychain failure?** Currently silent. If users are confused ("I set up keychain but tokens are on disk"), a single-line stderr diagnostic would help. Defer until users ask.
- **`oh mcp migrate` command?** Scans `~/.oh/credentials/mcp/*.json`, pushes each into the keychain, deletes the filesystem file on success. One-shot explicit tool. Reasonable follow-up; not in v1.
