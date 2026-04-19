/**
 * OS keychain backend for MCP OAuth tokens.
 *
 * Wraps @napi-rs/keyring (optional dependency). All functions catch every error
 * and return an "unavailable" sentinel so the orchestrator in oauth-storage.ts
 * can fall back to the filesystem store without any user-visible disruption.
 */

import { createRequire } from "node:module";
import type { OhCredentials } from "./oauth-storage-fs.js";

const SERVICE = "openharness-mcp";
const nodeRequire = createRequire(import.meta.url);

interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

type EntryCtor = new (service: string, account: string) => KeyringEntry;

let entryCtorCache: EntryCtor | null | undefined;

function getEntryCtor(): EntryCtor | null {
  if (entryCtorCache !== undefined) return entryCtorCache;
  try {
    const mod = nodeRequire("@napi-rs/keyring") as { Entry: EntryCtor };
    entryCtorCache = mod.Entry;
  } catch {
    entryCtorCache = null;
  }
  return entryCtorCache;
}

/** Clear the cached module reference. For tests only. */
export function _resetForTesting(): void {
  entryCtorCache = undefined;
}

/** True iff @napi-rs/keyring loaded successfully AND the platform has an Entry class. */
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
