import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { invalidateConfigCache } from "../harness/config.js";
import { _resetForTesting } from "./oauth-keychain.js";
import { loadCredentials, type OhCredentials, saveCredentials } from "./oauth-storage.js";
import { loadCredentials as loadFs, saveCredentials as saveFs } from "./oauth-storage-fs.js";

const testRequire = createRequire(import.meta.url);

function installFakeKeyring(): { restore: () => void; store: Map<string, string> } {
  const store = new Map<string, string>();
  class FakeEntry {
    constructor(
      readonly service: string,
      readonly account: string,
    ) {}
    setPassword(pw: string): void {
      store.set(`${this.service}:${this.account}`, pw);
    }
    getPassword(): string | null {
      return store.get(`${this.service}:${this.account}`) ?? null;
    }
    deletePassword(): boolean {
      return store.delete(`${this.service}:${this.account}`);
    }
  }
  const ModuleAny = testRequire("node:module") as { _cache: Record<string, { exports: unknown }> };
  const key = testRequire.resolve("@napi-rs/keyring");
  ModuleAny._cache[key] = { exports: { Entry: FakeEntry } };
  return {
    restore: () => {
      delete ModuleAny._cache[key];
    },
    store,
  };
}

async function withTmpConfigCwd(yaml: string, fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "oh-oauth-storage-"));
  const original = process.cwd();
  // The test runner sets OH_KEYCHAIN=disabled globally so individual tests don't
  // leak into the real OS keychain. Re-enable for these orchestrator tests that
  // explicitly install a fake keyring.
  const originalEnvKey = process.env.OH_KEYCHAIN;
  process.env.OH_KEYCHAIN = "auto";
  process.chdir(dir);
  try {
    mkdirSync(`${dir}/.oh`, { recursive: true });
    writeFileSync(`${dir}/.oh/config.yaml`, yaml);
    invalidateConfigCache();
    await fn();
  } finally {
    process.chdir(original);
    if (originalEnvKey === undefined) delete process.env.OH_KEYCHAIN;
    else process.env.OH_KEYCHAIN = originalEnvKey;
    invalidateConfigCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

const sample: OhCredentials = {
  issuerUrl: "https://auth.example.com",
  clientInformation: { client_id: "cid" },
  tokens: { access_token: "from-kc", token_type: "Bearer" },
  updatedAt: new Date().toISOString(),
};

describe("oauth-storage orchestrator", () => {
  it("credentials.storage: 'filesystem' bypasses keychain even when available", async () => {
    _resetForTesting();
    const { restore, store } = installFakeKeyring();
    const fsDir = mkdtempSync(join(tmpdir(), "oh-oauth-fs-"));
    try {
      await withTmpConfigCwd(
        ["provider: mock", "model: mock", "permissionMode: ask", "credentials:", "  storage: filesystem", ""].join(
          "\n",
        ),
        async () => {
          await saveCredentials(fsDir, "svr-fs-forced", sample);
          assert.equal(store.size, 0, "keychain should not have received the write");
          const fromFs = await loadFs(fsDir, "svr-fs-forced");
          assert.ok(fromFs, "filesystem should have received the write");
        },
      );
    } finally {
      rmSync(fsDir, { recursive: true, force: true });
      restore();
      _resetForTesting();
    }
  });

  it("default save goes to keychain when available (no filesystem file)", async () => {
    _resetForTesting();
    const { restore, store } = installFakeKeyring();
    const fsDir = mkdtempSync(join(tmpdir(), "oh-oauth-fs-"));
    try {
      await withTmpConfigCwd(["provider: mock", "model: mock", "permissionMode: ask", ""].join("\n"), async () => {
        await saveCredentials(fsDir, "svr-kc-default", sample);
        assert.equal(store.size, 1, "keychain should have received the write");
        const fromFs = await loadFs(fsDir, "svr-kc-default");
        assert.equal(fromFs, undefined, "filesystem should NOT have been written");
      });
    } finally {
      rmSync(fsDir, { recursive: true, force: true });
      restore();
      _resetForTesting();
    }
  });

  it("load prefers keychain over filesystem when both have entries", async () => {
    _resetForTesting();
    const { restore } = installFakeKeyring();
    const fsDir = mkdtempSync(join(tmpdir(), "oh-oauth-fs-"));
    try {
      // Seed filesystem with one value…
      await saveFs(fsDir, "svr-both", { ...sample, tokens: { access_token: "from-fs", token_type: "Bearer" } });
      // …and keychain with another (via the orchestrator under keychain-enabled config).
      await withTmpConfigCwd(["provider: mock", "model: mock", "permissionMode: ask", ""].join("\n"), async () => {
        await saveCredentials(fsDir, "svr-both", sample); // writes "from-kc" to keychain
        const loaded = await loadCredentials(fsDir, "svr-both");
        assert.ok(loaded);
        assert.equal(loaded!.tokens.access_token, "from-kc", "keychain value should win");
      });
    } finally {
      rmSync(fsDir, { recursive: true, force: true });
      restore();
      _resetForTesting();
    }
  });
});
