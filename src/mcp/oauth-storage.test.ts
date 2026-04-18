import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { deleteCredentials, loadCredentials, type OhCredentials, saveCredentials } from "./oauth-storage.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "oh-oauth-storage-"));
}

const sample: OhCredentials = {
  issuerUrl: "https://auth.example.com",
  clientInformation: { client_id: "abc" },
  tokens: { access_token: "at", refresh_token: "rt", expires_at: Date.now() + 60_000, token_type: "Bearer" },
  updatedAt: new Date().toISOString(),
};

describe("oauth-storage", () => {
  it("saveCredentials + loadCredentials round-trip", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "linear", sample);
      const loaded = await loadCredentials(dir, "linear");
      assert.deepEqual(loaded, sample);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadCredentials returns undefined when file is absent", async () => {
    const dir = freshDir();
    try {
      const loaded = await loadCredentials(dir, "nope");
      assert.equal(loaded, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadCredentials returns undefined on corrupt JSON (without throwing)", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "x", sample);
      writeFileSync(join(dir, "x.json"), "{not valid json");
      const loaded = await loadCredentials(dir, "x");
      assert.equal(loaded, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deleteCredentials removes the file idempotently", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "bye", sample);
      await deleteCredentials(dir, "bye");
      assert.equal(await loadCredentials(dir, "bye"), undefined);
      await deleteCredentials(dir, "bye"); // idempotent
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveCredentials writes mode 0600 on non-Windows", async () => {
    if (process.platform === "win32") return;
    const dir = freshDir();
    try {
      await saveCredentials(dir, "m", sample);
      const s = statSync(join(dir, "m.json"));
      assert.equal(s.mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
