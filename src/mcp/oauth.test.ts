import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { NormalizedConfig } from "./config-normalize.js";
import {
  awaitOAuthCallback,
  buildAuthProvider,
  clearTokens,
  getAuthStatus,
  OhOAuthProvider,
  redactToken,
} from "./oauth.js";
import { loadCredentials, saveCredentials } from "./oauth-storage.js";

describe("awaitOAuthCallback", () => {
  it("resolves with {code, state} on a valid GET /oauth/callback", async () => {
    const pending = await awaitOAuthCallback({ timeoutMs: 2_000 });
    // Trigger the callback via a real HTTP GET
    const res = await fetch(`${pending.redirectUri}?code=CODE123&state=STATE456`);
    assert.ok(res.ok);
    const result = await pending.done;
    assert.equal(result.code, "CODE123");
    assert.equal(result.state, "STATE456");
  });

  it("rejects on timeout", async () => {
    const pending = await awaitOAuthCallback({ timeoutMs: 200 });
    await assert.rejects(() => pending.done, /timeout/i);
    pending.close(); // idempotent
  });

  it("rejects non-/oauth/callback paths with 404 and does NOT resolve", async () => {
    const pending = await awaitOAuthCallback({ timeoutMs: 1_000 });
    const res = await fetch(`${pending.redirectUri.replace("/oauth/callback", "/evil")}?code=X&state=Y`);
    assert.equal(res.status, 404);
    pending.close();
    await assert.rejects(() => pending.done, /closed|cancel|timeout/i);
  });
});

describe("redactToken", () => {
  it("redacts access_token= in query strings", () => {
    const msg = "failed: https://a/token?access_token=sk-1234&state=x";
    assert.match(redactToken(msg), /access_token=<redacted>/);
    assert.doesNotMatch(redactToken(msg), /sk-1234/);
  });

  it("redacts refresh_token= in form bodies", () => {
    const msg = "body: grant_type=refresh_token&refresh_token=rt-9999&client_id=foo";
    assert.match(redactToken(msg), /refresh_token=<redacted>/);
    assert.doesNotMatch(redactToken(msg), /rt-9999/);
  });

  it("redacts bearer tokens in Authorization strings", () => {
    const msg = 'header: "Authorization: Bearer sk-secret-abc"';
    assert.match(redactToken(msg), /Bearer <redacted>/);
    assert.doesNotMatch(redactToken(msg), /sk-secret-abc/);
  });

  it("is a no-op on strings without tokens", () => {
    assert.equal(redactToken("nothing to see here"), "nothing to see here");
  });
});

describe("OhOAuthProvider", () => {
  function freshDir(): string {
    return mkdtempSync(join(tmpdir(), "oh-oauth-provider-"));
  }

  it("tokens() returns undefined when no credentials file exists", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      assert.equal(await p.tokens(), undefined);
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveTokens + tokens() round-trip", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      await p.saveTokens({
        access_token: "at",
        refresh_token: "rt",
        token_type: "Bearer",
        expires_in: 60,
      } as any);
      const t = await p.tokens();
      assert.equal(t?.access_token, "at");
      assert.equal(t?.refresh_token, "rt");
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveClientInformation + clientInformation round-trip", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      await p.saveClientInformation({ client_id: "cid", client_secret: "cs" } as any);
      const info = await p.clientInformation();
      assert.equal(info?.client_id, "cid");
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveCodeVerifier + codeVerifier round-trip; cleared after saveTokens", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      await p.saveCodeVerifier("v-abc");
      assert.equal(await p.codeVerifier(), "v-abc");
      await p.saveTokens({ access_token: "at", token_type: "Bearer" } as any);
      await assert.rejects(() => p.codeVerifier(), /no code verifier/i);
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("codeVerifier() throws if called before saveCodeVerifier", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      await assert.rejects(() => p.codeVerifier(), /no code verifier/i);
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redirectUrl is available after ready()", async () => {
    const dir = freshDir();
    try {
      const p = new OhOAuthProvider({ name: "srv", storageDir: dir, openFn: async () => {} });
      await p.ready();
      assert.match(p.redirectUrl as string, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redirectToAuthorization calls openFn with the URL", async () => {
    const dir = freshDir();
    try {
      const seen: string[] = [];
      const p = new OhOAuthProvider({
        name: "srv",
        storageDir: dir,
        openFn: async (url) => {
          seen.push(url);
        },
      });
      await p.ready();
      await p.redirectToAuthorization(new URL("https://auth.example.com/authorize?foo=bar"));
      assert.equal(seen.length, 1);
      assert.equal(seen[0], "https://auth.example.com/authorize?foo=bar");
      p.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildAuthProvider", () => {
  function cfgHttp(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
    return { name: "srv", type: "http", url: "https://x/mcp", ...overrides } as NormalizedConfig;
  }

  it("returns a provider for http configs without headers.Authorization and without auth='none'", () => {
    const p = buildAuthProvider(cfgHttp(), "/tmp/oh-test", async () => {});
    assert.ok(p !== undefined);
  });

  it("returns undefined when headers.Authorization is set", () => {
    const p = buildAuthProvider(
      cfgHttp({ headers: { Authorization: "Bearer x" } } as any),
      "/tmp/oh-test",
      async () => {},
    );
    assert.equal(p, undefined);
  });

  it("returns undefined when auth='none'", () => {
    const p = buildAuthProvider(cfgHttp({ auth: "none" } as any), "/tmp/oh-test", async () => {});
    assert.equal(p, undefined);
  });

  it("returns undefined for stdio configs", () => {
    const p = buildAuthProvider(
      { name: "fs", type: "stdio", command: "x" } as NormalizedConfig,
      "/tmp/oh-test",
      async () => {},
    );
    assert.equal(p, undefined);
  });

  it("returns a provider for sse configs when eligible", () => {
    const p = buildAuthProvider(
      { name: "legacy", type: "sse", url: "https://x/sse" } as NormalizedConfig,
      "/tmp/oh-test",
      async () => {},
    );
    assert.ok(p !== undefined);
  });
});

describe("getAuthStatus", () => {
  function freshDir(): string {
    return mkdtempSync(join(tmpdir(), "oh-oauth-status-"));
  }

  it("returns 'n/a' for stdio configs", async () => {
    const status = await getAuthStatus({ name: "fs", type: "stdio", command: "x" } as NormalizedConfig, "/tmp/nope");
    assert.equal(status, "n/a");
  });

  it("returns 'n/a' when headers.Authorization is set", async () => {
    const status = await getAuthStatus(
      {
        name: "s",
        type: "http",
        url: "http://x",
        headers: { Authorization: "Bearer x" },
      } as NormalizedConfig,
      "/tmp/nope",
    );
    assert.equal(status, "n/a");
  });

  it("returns 'none' when no credentials file exists", async () => {
    const dir = freshDir();
    try {
      const status = await getAuthStatus({ name: "s", type: "http", url: "http://x" } as NormalizedConfig, dir);
      assert.equal(status, "none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 'authenticated' when expires_at is in the future", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "s", {
        issuerUrl: "x",
        clientInformation: { client_id: "c" },
        tokens: { access_token: "at", expires_at: Date.now() + 60_000 },
        updatedAt: new Date().toISOString(),
      });
      const status = await getAuthStatus({ name: "s", type: "http", url: "http://x" } as NormalizedConfig, dir);
      assert.equal(status, "authenticated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 'expired' when expires_at is in the past", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "s", {
        issuerUrl: "x",
        clientInformation: { client_id: "c" },
        tokens: { access_token: "at", expires_at: Date.now() - 60_000 },
        updatedAt: new Date().toISOString(),
      });
      const status = await getAuthStatus({ name: "s", type: "http", url: "http://x" } as NormalizedConfig, dir);
      assert.equal(status, "expired");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("clearTokens", () => {
  it("deletes the credentials file idempotently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-oauth-clear-"));
    try {
      await saveCredentials(dir, "bye", {
        issuerUrl: "x",
        clientInformation: { client_id: "c" },
        tokens: { access_token: "at" },
        updatedAt: new Date().toISOString(),
      });
      await clearTokens(dir, "bye");
      assert.equal(await loadCredentials(dir, "bye"), undefined);
      await clearTokens(dir, "bye"); // idempotent
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
