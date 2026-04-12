import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHARS_PER_TOKEN_BY_PROVIDER, defaultEstimateTokens } from "./base.js";

describe("defaultEstimateTokens", () => {
  it('returns reasonable number for "hello world" with anthropic (~3-4)', () => {
    const tokens = defaultEstimateTokens("hello world", "anthropic");
    // "hello world" is 11 chars; ratio 3.3 => ceil(11/3.3) = 4
    assert.ok(tokens >= 3 && tokens <= 5, `Expected 3-5, got ${tokens}`);
  });

  it("uses different ratio for openai than anthropic", () => {
    const text = "a".repeat(100);
    const anthropicTokens = defaultEstimateTokens(text, "anthropic");
    const openaiTokens = defaultEstimateTokens(text, "openai");
    // anthropic ratio 3.3, openai ratio 3.5 => anthropic returns more tokens
    assert.notEqual(anthropicTokens, openaiTokens);
    assert.ok(anthropicTokens > openaiTokens, "anthropic (smaller ratio) should yield more tokens");
  });

  it("CHARS_PER_TOKEN_BY_PROVIDER has entries for anthropic, openai, ollama", () => {
    assert.ok("anthropic" in CHARS_PER_TOKEN_BY_PROVIDER);
    assert.ok("openai" in CHARS_PER_TOKEN_BY_PROVIDER);
    assert.ok("ollama" in CHARS_PER_TOKEN_BY_PROVIDER);
    assert.equal(typeof CHARS_PER_TOKEN_BY_PROVIDER.anthropic, "number");
    assert.equal(typeof CHARS_PER_TOKEN_BY_PROVIDER.openai, "number");
    assert.equal(typeof CHARS_PER_TOKEN_BY_PROVIDER.ollama, "number");
  });

  it("returns 0 for empty string", () => {
    const tokens = defaultEstimateTokens("", "anthropic");
    assert.equal(tokens, 0);
  });
});
