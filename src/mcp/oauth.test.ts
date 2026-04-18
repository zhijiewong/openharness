import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { awaitOAuthCallback, OhOAuthProvider, redactToken } from "./oauth.js";

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
