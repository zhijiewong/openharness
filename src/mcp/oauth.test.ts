import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { awaitOAuthCallback } from "./oauth.js";

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
