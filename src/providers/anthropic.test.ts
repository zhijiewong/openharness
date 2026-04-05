import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "./anthropic.js";

test("Anthropic healthCheck returns true when apiKey is set", async () => {
  const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test-key" });
  assert.equal(await provider.healthCheck(), true);
});

test("Anthropic healthCheck returns false when apiKey is missing", async () => {
  const provider = new AnthropicProvider({ name: "anthropic" });
  assert.equal(await provider.healthCheck(), false);
});

test("Anthropic listModels returns hardcoded models", () => {
  const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test-key" });
  const models = provider.listModels();
  assert.ok(models.length > 0);
  assert.ok(models.some(m => m.id.includes("claude")));
});
