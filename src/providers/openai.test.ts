import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "./openai.js";

const originalFetch = globalThis.fetch;

test("OpenAI healthCheck returns true when /models responds OK", async () => {
  globalThis.fetch = mock.fn(async () => new Response("{}", { status: 200 })) as any;
  const provider = new OpenAIProvider({ name: "openai", apiKey: "test-key" });
  assert.equal(await provider.healthCheck(), true);
  globalThis.fetch = originalFetch;
});

test("OpenAI healthCheck returns false on error", async () => {
  globalThis.fetch = mock.fn(async () => { throw new Error("network"); }) as any;
  const provider = new OpenAIProvider({ name: "openai", apiKey: "test-key" });
  assert.equal(await provider.healthCheck(), false);
  globalThis.fetch = originalFetch;
});

test("OpenAI listModels returns hardcoded models", () => {
  const provider = new OpenAIProvider({ name: "openai", apiKey: "test-key" });
  const models = provider.listModels();
  assert.ok(models.length > 0);
  assert.ok(models.some(m => m.id.includes("gpt")));
});
