import test from "node:test";
import assert from "node:assert/strict";
import { WebFetchTool } from "./WebFetchTool/index.js";

const ctx = { workingDir: process.cwd() };

test("blocks localhost", async () => {
  const r = await WebFetchTool.call({ url: "http://localhost:8080/secret" }, ctx);
  assert.equal(r.isError, true);
  assert.ok(r.output.includes("blocked"));
});

test("blocks 192.168.x.x", async () => {
  const r = await WebFetchTool.call({ url: "http://192.168.1.1/" }, ctx);
  assert.equal(r.isError, true);
  assert.ok(r.output.includes("blocked"));
});

test("blocks .internal hostnames", async () => {
  const r = await WebFetchTool.call({ url: "http://app.internal/api" }, ctx);
  assert.equal(r.isError, true);
  assert.ok(r.output.includes("blocked"));
});

test("allows normal https URLs (will fail to connect but not blocked)", async () => {
  // Use a URL that won't actually resolve to avoid network calls,
  // but the SSRF check itself should pass (error will be a fetch error, not "blocked")
  const r = await WebFetchTool.call({ url: "https://example.invalid/page" }, ctx);
  // Should NOT be the SSRF block message
  assert.ok(!r.output.includes("private/internal hosts is blocked"));
});
