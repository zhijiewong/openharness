/**
 * Secure credential storage — stores API keys encrypted on disk
 * instead of plaintext in config.yaml.
 *
 * Uses AES-256-GCM with a key derived from machine identity.
 * Not bulletproof (key derivation is deterministic from machine info),
 * but far better than plaintext YAML.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";

const CRED_DIR = join(homedir(), ".oh");
const CRED_PATH = join(CRED_DIR, "credentials.enc");
const ALGORITHM = "aes-256-gcm";

/** Derive an encryption key from machine identity */
function deriveKey(): Buffer {
  const identity = `${hostname()}-${userInfo().username}-openharness`;
  return scryptSync(identity, "oh-credential-salt", 32);
}

type CredentialStore = Record<string, string>;

function encrypt(data: string): Buffer {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [iv (12)] [tag (16)] [encrypted data]
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf-8") + decipher.final("utf-8");
}

function loadStore(): CredentialStore {
  if (!existsSync(CRED_PATH)) return {};
  try {
    const raw = readFileSync(CRED_PATH);
    const json = decrypt(raw);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function saveStore(store: CredentialStore): void {
  mkdirSync(CRED_DIR, { recursive: true });
  const json = JSON.stringify(store);
  writeFileSync(CRED_PATH, encrypt(json));
}

/** Get a stored credential by key (e.g., "anthropic-api-key") */
export function getCredential(key: string): string | undefined {
  return loadStore()[key];
}

/** Store a credential */
export function setCredential(key: string, value: string): void {
  const store = loadStore();
  store[key] = value;
  saveStore(store);
}

/** Delete a credential */
export function deleteCredential(key: string): void {
  const store = loadStore();
  delete store[key];
  saveStore(store);
}

/** List credential keys (not values) */
export function listCredentials(): string[] {
  return Object.keys(loadStore());
}

/**
 * Get API key for a provider, checking:
 * 1. Environment variable (highest priority)
 * 2. Encrypted credential store
 * 3. Config file (legacy plaintext, with migration prompt)
 */
export function resolveApiKey(provider: string, configApiKey?: string): string | undefined {
  // Environment variable names by provider
  const envVarMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };

  const envVar = envVarMap[provider];
  if (envVar && process.env[envVar]) return process.env[envVar];

  // Encrypted store
  const stored = getCredential(`${provider}-api-key`);
  if (stored) return stored;

  // Legacy config (migrate on use)
  if (configApiKey) {
    // Auto-migrate to encrypted store
    setCredential(`${provider}-api-key`, configApiKey);
    return configApiKey;
  }

  return undefined;
}
