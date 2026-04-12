import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// We test the crypto functions by importing the module and
// testing through the public API. To isolate from real credentials,
// we override HOME so the credential file goes to a tmpdir.

const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;

function setupTmpHome(): string {
  const tmp = mkdtempSync(join(tmpdir(), "oh-cred-test-"));
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  return tmp;
}

function restoreHome(): void {
  if (origHome) process.env.HOME = origHome;
  if (origUserProfile) process.env.USERPROFILE = origUserProfile;
}

// Dynamic import to pick up HOME override
async function _loadModule() {
  // Clear module cache by importing with timestamp query
  const mod = await import(`./credentials.js?t=${Date.now()}`);
  return mod;
}

test("credentials: setCredential + getCredential roundtrip", async () => {
  const _tmp = setupTmpHome();
  try {
    const { setCredential, getCredential } = await import("./credentials.js");
    setCredential("test-key", "secret-value-123");
    const val = getCredential("test-key");
    assert.equal(val, "secret-value-123");
  } finally {
    restoreHome();
  }
});

test("credentials: getCredential returns undefined for missing key", async () => {
  const _tmp = setupTmpHome();
  try {
    const { getCredential } = await import("./credentials.js");
    const val = getCredential("nonexistent-key");
    assert.equal(val, undefined);
  } finally {
    restoreHome();
  }
});

test("credentials: deleteCredential removes key", async () => {
  const _tmp = setupTmpHome();
  try {
    const { setCredential, getCredential, deleteCredential } = await import("./credentials.js");
    setCredential("to-delete", "val");
    deleteCredential("to-delete");
    const val = getCredential("to-delete");
    assert.equal(val, undefined);
  } finally {
    restoreHome();
  }
});

test("credentials: listCredentials returns all keys", async () => {
  const _tmp = setupTmpHome();
  try {
    const { setCredential, listCredentials } = await import("./credentials.js");
    setCredential("key-a", "val-a");
    setCredential("key-b", "val-b");
    const keys = listCredentials();
    assert.ok(keys.includes("key-a"));
    assert.ok(keys.includes("key-b"));
  } finally {
    restoreHome();
  }
});

test("credentials: resolveApiKey prefers env var", async () => {
  const _tmp = setupTmpHome();
  const origKey = process.env.ANTHROPIC_API_KEY;
  try {
    const { resolveApiKey, setCredential } = await import("./credentials.js");
    setCredential("anthropic-api-key", "stored-key");
    process.env.ANTHROPIC_API_KEY = "env-key";
    const result = resolveApiKey("anthropic");
    assert.equal(result, "env-key");
  } finally {
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    else delete process.env.ANTHROPIC_API_KEY;
    restoreHome();
  }
});

test("credentials: resolveApiKey falls back to encrypted store", async () => {
  const _tmp = setupTmpHome();
  const origKey = process.env.ANTHROPIC_API_KEY;
  try {
    const { resolveApiKey, setCredential } = await import("./credentials.js");
    delete process.env.ANTHROPIC_API_KEY;
    setCredential("anthropic-api-key", "stored-key");
    const result = resolveApiKey("anthropic");
    assert.equal(result, "stored-key");
  } finally {
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    restoreHome();
  }
});
