import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolContext } from "../Tool.js";
import { createMockTool } from "../test-helpers.js";
import { formatPipelineResults, PipelineExecutor } from "./PipelineExecutor.js";

const ctx: ToolContext = { workingDir: "/tmp" };

function makeTools() {
  return [
    createMockTool("ToolA", { result: { output: "result-a", isError: false } }),
    createMockTool("ToolB", { result: { output: "result-b", isError: false } }),
    createMockTool("ToolC", { result: { output: "result-c", isError: false } }),
    createMockTool("FailTool", { result: { output: "error!", isError: true } }),
  ];
}

describe("PipelineExecutor", () => {
  it("executes a single step", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([{ id: "step1", tool: "ToolA", args: {} }]);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.stepId, "step1");
    assert.equal(results[0]!.output, "result-a");
    assert.equal(results[0]!.isError, false);
  });

  it("executes linear pipeline (A → B → C)", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([
      { id: "s1", tool: "ToolA", args: {} },
      { id: "s2", tool: "ToolB", args: {}, dependsOn: ["s1"] },
      { id: "s3", tool: "ToolC", args: {}, dependsOn: ["s2"] },
    ]);
    assert.equal(results.length, 3);
    assert.equal(results[0]!.stepId, "s1");
    assert.equal(results[1]!.stepId, "s2");
    assert.equal(results[2]!.stepId, "s3");
    assert.ok(results.every((r) => !r.isError));
  });

  it("executes parallel steps (A + B → C)", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([
      { id: "a", tool: "ToolA", args: {} },
      { id: "b", tool: "ToolB", args: {} },
      { id: "c", tool: "ToolC", args: {}, dependsOn: ["a", "b"] },
    ]);
    assert.equal(results.length, 3);
    const cResult = results.find((r) => r.stepId === "c");
    assert.ok(cResult);
    assert.equal(cResult.isError, false);
  });

  it("substitutes $ref variables", async () => {
    // ToolA returns "result-a", ToolB should receive it as input
    const tools = makeTools();
    const executor = new PipelineExecutor(tools, ctx);
    const results = await executor.execute([
      { id: "first", tool: "ToolA", args: {} },
      { id: "second", tool: "ToolB", args: { input: "$first" }, dependsOn: ["first"] },
    ]);
    assert.equal(results.length, 2);
    // Both should succeed (mock tools accept any input)
    assert.ok(results.every((r) => !r.isError));
  });

  it("skips dependents when blocker fails", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([
      { id: "fail", tool: "FailTool", args: {} },
      { id: "after", tool: "ToolA", args: {}, dependsOn: ["fail"] },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0]!.stepId, "fail");
    assert.equal(results[0]!.isError, true);
    assert.equal(results[1]!.stepId, "after");
    assert.equal(results[1]!.isError, true);
    assert.ok(results[1]!.output.includes("Skipped"));
  });

  it("returns error for unknown tool", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([{ id: "bad", tool: "NonExistent", args: {} }]);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.isError, true);
    assert.ok(results[0]!.output.includes("unknown tool"));
  });

  it("returns error for duplicate step IDs", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([
      { id: "dup", tool: "ToolA", args: {} },
      { id: "dup", tool: "ToolB", args: {} },
    ]);
    assert.equal(results.length, 1);
    assert.ok(results[0]!.isError);
    assert.ok(results[0]!.output.includes("duplicate"));
  });

  it("tracks duration per step", async () => {
    const tools = [createMockTool("Slow", { delay: 20 })];
    const executor = new PipelineExecutor(tools, ctx);
    const results = await executor.execute([{ id: "slow", tool: "Slow", args: {} }]);
    assert.ok(results[0]!.durationMs >= 10);
  });

  it("handles empty pipeline", async () => {
    const executor = new PipelineExecutor(makeTools(), ctx);
    const results = await executor.execute([]);
    assert.equal(results.length, 0);
  });
});

describe("formatPipelineResults", () => {
  it("formats success results", () => {
    const output = formatPipelineResults([
      { stepId: "a", output: "hello", isError: false, durationMs: 10 },
      { stepId: "b", output: "world", isError: false, durationMs: 20 },
    ]);
    assert.ok(output.includes('✓ Step "a"'));
    assert.ok(output.includes('✓ Step "b"'));
    assert.ok(output.includes("2/2 steps passed"));
  });

  it("formats failure results", () => {
    const output = formatPipelineResults([{ stepId: "fail", output: "error!", isError: true, durationMs: 5 }]);
    assert.ok(output.includes('✗ Step "fail"'));
    assert.ok(output.includes("0/1 steps passed"));
  });
});
