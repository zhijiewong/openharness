import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { LlamaCppProvider } from "./llamacpp.js";

const originalFetch = globalThis.fetch;

test("LlamaCpp fetchModels returns models from /v1/models", async () => {
  globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
    data: [{ id: "llama3-local" }],
  }), { status: 200 })) as any;

  const provider = new LlamaCppProvider({ name: "llamacpp" });
  const models = await provider.fetchModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]!.id, "llama3-local");

  globalThis.fetch = originalFetch;
});

test("LlamaCpp fetchModels returns [] on error", async () => {
  globalThis.fetch = mock.fn(async () => { throw new Error("ECONNREFUSED"); }) as any;
  const provider = new LlamaCppProvider({ name: "llamacpp" });
  assert.deepEqual(await provider.fetchModels(), []);
  globalThis.fetch = originalFetch;
});

test("LlamaCpp healthCheck returns true when /v1/models responds OK", async () => {
  globalThis.fetch = mock.fn(async () => new Response("{}", { status: 200 })) as any;
  const provider = new LlamaCppProvider({ name: "llamacpp" });
  assert.equal(await provider.healthCheck(), true);
  globalThis.fetch = originalFetch;
});

test("LlamaCpp healthCheck returns false on error", async () => {
  globalThis.fetch = mock.fn(async () => { throw new Error("ECONNREFUSED"); }) as any;
  const provider = new LlamaCppProvider({ name: "llamacpp" });
  assert.equal(await provider.healthCheck(), false);
  globalThis.fetch = originalFetch;
});
