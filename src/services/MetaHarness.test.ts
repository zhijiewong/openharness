import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOptimizationResult, type OptimizationResult, runBenchmark } from "./MetaHarness.js";

describe("MetaHarness", () => {
  describe("runBenchmark", () => {
    it("scores passing tests as high", async () => {
      const result = await runBenchmark('echo "5 pass, 0 fail"');
      assert.ok(result.score > 0.8);
      assert.ok(result.durationMs >= 0);
    });

    it("scores failing tests lower", async () => {
      const result = await runBenchmark('echo "3 pass, 2 fail"');
      assert.ok(result.score > 0);
      assert.ok(result.score < 1);
      // 3/5 = 0.6
      assert.ok(Math.abs(result.score - 0.6) < 0.1);
    });

    it("handles TAP format output", async () => {
      const result = await runBenchmark('echo "# pass 10" && echo "# fail 2"');
      // 10/12 ≈ 0.833
      assert.ok(result.score > 0.7);
    });

    it("handles command failure gracefully", async () => {
      const result = await runBenchmark("exit 1");
      assert.ok(result.score < 0.5);
      assert.ok(result.durationMs >= 0);
    });
  });

  describe("formatOptimizationResult", () => {
    it("formats improvement result", () => {
      const result: OptimizationResult = {
        initialScore: 0.65,
        finalScore: 0.82,
        iterations: 5,
        changes: [
          { description: "Trimmed system prompt", field: "systemPrompt", oldValue: null, newValue: null, impact: 0.1 },
          { description: "Added test command", field: "verification", oldValue: null, newValue: null, impact: 0.07 },
        ],
        totalDurationMs: 30_000,
      };
      const output = formatOptimizationResult(result);
      assert.ok(output.includes("0.650"));
      assert.ok(output.includes("0.820"));
      assert.ok(output.includes("Trimmed system prompt"));
      assert.ok(output.includes("+0.100"));
    });

    it("formats no-improvement result", () => {
      const result: OptimizationResult = {
        initialScore: 0.9,
        finalScore: 0.9,
        iterations: 3,
        changes: [],
        totalDurationMs: 15_000,
      };
      const output = formatOptimizationResult(result);
      assert.ok(output.includes("No improvements"));
    });
  });
});
