import assert from "node:assert/strict";
import test from "node:test";
import { CostTracker, estimateCost } from "./cost.js";

test("record() updates totals", () => {
  const t = new CostTracker();
  t.record("openai", "gpt-4o", 100, 50, 0.01);
  assert.equal(t.events.length, 1);
  assert.equal(t.modelUsage.get("gpt-4o")!.requests, 1);
});

test("totalCost, totalInputTokens, totalOutputTokens", () => {
  const t = new CostTracker();
  t.record("openai", "gpt-4o", 100, 50, 0.01);
  t.record("openai", "gpt-4o", 200, 100, 0.02);
  assert.equal(t.totalCost, 0.03);
  assert.equal(t.totalInputTokens, 300);
  assert.equal(t.totalOutputTokens, 150);
});

test("isOverBudget() with budget set", () => {
  const t = new CostTracker(0.01);
  t.record("openai", "gpt-4o", 100, 50, 0.02);
  assert.equal(t.isOverBudget(), true);
});

test("isOverBudget() returns false with no budget", () => {
  const t = new CostTracker();
  t.record("openai", "gpt-4o", 100, 50, 999);
  assert.equal(t.isOverBudget(), false);
});

test("formatSummary() returns a string", () => {
  const t = new CostTracker(1.0);
  t.record("openai", "gpt-4o", 1000, 500, 0.05);
  const s = t.formatSummary();
  assert.equal(typeof s, "string");
  assert.ok(s.includes("Total cost"));
  assert.ok(s.includes("gpt-4o"));
});

test("estimateCost() with known model returns > 0", () => {
  const c = estimateCost("gpt-4o", 1_000_000, 1_000_000);
  assert.ok(c > 0);
});

test("estimateCost() with unknown model returns 0", () => {
  assert.equal(estimateCost("unknown-model", 1000, 1000), 0);
});
