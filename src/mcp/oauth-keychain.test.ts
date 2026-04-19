import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  _resetForTesting,
  deleteCredentialsKeychain,
  keychainAvailable,
  loadCredentialsKeychain,
  saveCredentialsKeychain,
} from "./oauth-keychain.js";
import type { OhCredentials } from "./oauth-storage-fs.js";

const testRequire = createRequire(import.meta.url);

/** Build a fake @napi-rs/keyring Entry class backed by an in-memory map. */
function makeFakeKeyringModule(): {
  mod: { Entry: new (s: string, a: string) => unknown };
  store: Map<string, string>;
} {
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
  return { mod: { Entry: FakeEntry }, store };
}

/** Seed CommonJS's require cache so the keychain module's internal require returns the fake. */
function installFakeKeyring(mod: unknown): () => void {
  const ModuleAny = testRequire("node:module") as { _cache: Record<string, { exports: unknown }> };
  const key = testRequire.resolve("@napi-rs/keyring");
  ModuleAny._cache[key] = { exports: mod };
  return () => {
    delete ModuleAny._cache[key];
  };
}

const sample: OhCredentials = {
  issuerUrl: "https://auth.example.com",
  clientInformation: { client_id: "cid" },
  tokens: { access_token: "at", refresh_token: "rt", token_type: "Bearer" },
  updatedAt: new Date().toISOString(),
};

describe("oauth-keychain (mocked keyring module)", () => {
  it("round-trips credentials when keyring is available", () => {
    _resetForTesting();
    const { mod } = makeFakeKeyringModule();
    const restore = installFakeKeyring(mod);
    try {
      assert.equal(keychainAvailable(), true);
      assert.equal(saveCredentialsKeychain("svr-a", sample), true);
      const loaded = loadCredentialsKeychain("svr-a");
      assert.ok(loaded);
      assert.equal(loaded!.tokens.access_token, "at");
    } finally {
      restore();
      _resetForTesting();
    }
  });

  it("returns undefined when the keyring entry does not exist", () => {
    _resetForTesting();
    const { mod } = makeFakeKeyringModule();
    const restore = installFakeKeyring(mod);
    try {
      assert.equal(loadCredentialsKeychain("never-saved"), undefined);
    } finally {
      restore();
      _resetForTesting();
    }
  });

  it("delete is idempotent", () => {
    _resetForTesting();
    const { mod } = makeFakeKeyringModule();
    const restore = installFakeKeyring(mod);
    try {
      saveCredentialsKeychain("svr-b", sample);
      assert.equal(deleteCredentialsKeychain("svr-b"), true);
      const second = deleteCredentialsKeychain("svr-b");
      assert.equal(typeof second, "boolean");
    } finally {
      restore();
      _resetForTesting();
    }
  });

  it("setPassword throwing is caught and reported as save failure", () => {
    _resetForTesting();
    const throwingMod = {
      Entry: class {
        setPassword(): void {
          throw new Error("user cancelled");
        }
        getPassword(): string | null {
          return null;
        }
        deletePassword(): boolean {
          return false;
        }
      },
    };
    const restore = installFakeKeyring(throwingMod);
    try {
      assert.equal(saveCredentialsKeychain("svr-c", sample), false);
    } finally {
      restore();
      _resetForTesting();
    }
  });
});
