import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelRouter } from "./router.js";

describe("ModelRouter", () => {
  const router = new ModelRouter(
    { fast: "qwen:7b", balanced: "gpt-4o-mini", powerful: "claude-sonnet" },
    "default-model",
  );

  it("routes early exploration to fast model", () => {
    const result = router.select({ turn: 1, hadToolCalls: true, toolCallCount: 2 });
    assert.equal(result.tier, "fast");
    assert.equal(result.model, "qwen:7b");
  });

  it("routes final response to powerful model", () => {
    const result = router.select({ turn: 5, hadToolCalls: false, toolCallCount: 0, isFinalResponse: true });
    assert.equal(result.tier, "powerful");
    assert.equal(result.model, "claude-sonnet");
  });

  it("routes high context pressure to fast model", () => {
    const result = router.select({ turn: 3, hadToolCalls: false, toolCallCount: 0, contextUsage: 0.85 });
    assert.equal(result.tier, "fast");
    assert.ok(result.reason.includes("context pressure"));
  });

  it("routes code-reviewer role to powerful model", () => {
    const result = router.select({ turn: 3, hadToolCalls: true, toolCallCount: 1, role: "code-reviewer" });
    assert.equal(result.tier, "powerful");
  });

  it("routes evaluator role to powerful model", () => {
    const result = router.select({ turn: 3, hadToolCalls: true, toolCallCount: 1, role: "evaluator" });
    assert.equal(result.tier, "powerful");
  });

  it("routes tool-heavy turns to fast model", () => {
    const result = router.select({ turn: 3, hadToolCalls: true, toolCallCount: 5 });
    assert.equal(result.tier, "fast");
  });

  it("defaults to balanced for normal turns", () => {
    const result = router.select({ turn: 3, hadToolCalls: true, toolCallCount: 1 });
    assert.equal(result.tier, "balanced");
    assert.equal(result.model, "gpt-4o-mini");
  });

  it("falls back to default model when tier not configured", () => {
    const minimal = new ModelRouter({}, "fallback-model");
    const result = minimal.select({ turn: 1, hadToolCalls: true, toolCallCount: 0 });
    assert.equal(result.model, "fallback-model");
  });

  it("isConfigured returns false when no tiers set", () => {
    const empty = new ModelRouter({}, "default");
    assert.equal(empty.isConfigured, false);
  });

  it("isConfigured returns true when any tier set", () => {
    const partial = new ModelRouter({ fast: "small-model" }, "default");
    assert.equal(partial.isConfigured, true);
  });

  it("tiers returns all models including defaults", () => {
    const tiers = router.tiers;
    assert.equal(tiers.fast, "qwen:7b");
    assert.equal(tiers.balanced, "gpt-4o-mini");
    assert.equal(tiers.powerful, "claude-sonnet");
  });

  it("context pressure takes priority over role", () => {
    const result = router.select({
      turn: 3,
      hadToolCalls: true,
      toolCallCount: 1,
      role: "code-reviewer",
      contextUsage: 0.9,
    });
    assert.equal(result.tier, "fast", "context pressure should override role");
  });
});
