/**
 * OAuth token storage orchestrator.
 *
 * Prefers the OS keychain via `oauth-keychain.ts` when available and not
 * opted out via `credentials.storage: "filesystem"`. Falls back to the
 * filesystem store in `oauth-storage-fs.ts` on any keychain failure.
 *
 * Public API unchanged: callers in oauth.ts and commands/mcp-auth.ts
 * continue to import `saveCredentials` / `loadCredentials` /
 * `deleteCredentials` / `OhCredentials` from this module.
 */

import { readOhConfig } from "../harness/config.js";
import {
  deleteCredentialsKeychain,
  keychainAvailable,
  loadCredentialsKeychain,
  saveCredentialsKeychain,
} from "./oauth-keychain.js";
import {
  deleteCredentials as deleteFs,
  loadCredentials as loadFs,
  saveCredentials as saveFs,
} from "./oauth-storage-fs.js";

export type { OhCredentials } from "./oauth-storage-fs.js";

import type { OhCredentials } from "./oauth-storage-fs.js";

function shouldUseKeychain(): boolean {
  // Explicit opt-out via env var (used by the test runner to isolate tests
  // from the real OS keychain). Accepts "disabled", "false", "0", or "off".
  const envOpt = (process.env.OH_KEYCHAIN ?? "").toLowerCase();
  if (envOpt === "disabled" || envOpt === "false" || envOpt === "0" || envOpt === "off") return false;
  const cfg = readOhConfig();
  if (cfg?.credentials?.storage === "filesystem") return false;
  return keychainAvailable();
}

/**
 * Save credentials. Tries keychain first when available; falls back to
 * filesystem on any keychain failure.
 */
export async function saveCredentials(storageDir: string, name: string, creds: OhCredentials): Promise<void> {
  if (shouldUseKeychain() && saveCredentialsKeychain(name, creds)) return;
  await saveFs(storageDir, name, creds);
}

/**
 * Load credentials. Checks keychain first (when available), then filesystem.
 * If both have entries for the same name, keychain wins.
 */
export async function loadCredentials(storageDir: string, name: string): Promise<OhCredentials | undefined> {
  if (shouldUseKeychain()) {
    const fromKc = loadCredentialsKeychain(name);
    if (fromKc) return fromKc;
  }
  return loadFs(storageDir, name);
}

/**
 * Delete credentials from BOTH keychain and filesystem. Idempotent.
 */
export async function deleteCredentials(storageDir: string, name: string): Promise<void> {
  if (keychainAvailable()) deleteCredentialsKeychain(name);
  await deleteFs(storageDir, name);
}
