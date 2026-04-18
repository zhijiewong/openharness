import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { awaitOAuthCallback, redactToken } from "./oauth.js";

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
