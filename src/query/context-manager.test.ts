import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContextManager } from "./context-manager.js";

describe("ContextManager", () => {
  describe("getToolBudget", () => {
    it("returns default budget for unknown tool", () => {
      const cm = new ContextManager();
      assert.equal(cm.getToolBudget("UnknownTool"), 10_000);
    });

    it("returns per-tool budget when set", () => {
      const cm = new ContextManager({ perTool: { Bash: 5000 } });
      assert.equal(cm.getToolBudget("Bash"), 5000);
      assert.equal(cm.getToolBudget("Read"), 10_000);
    });

    it("setToolBudget overrides default", () => {
      const cm = new ContextManager();
      cm.setToolBudget("Grep", 2000);
      assert.equal(cm.getToolBudget("Grep"), 2000);
    });
  });

  describe("enforceToolBudget", () => {
    it("returns short output unchanged", () => {
      const cm = new ContextManager();
      const output = "hello world";
      assert.equal(cm.enforceToolBudget("Read", output), output);
    });

    it("truncates output exceeding budget", () => {
      const cm = new ContextManager({ perTool: { Test: 10 } }); // 10 tokens ≈ 40 chars
      const output = "x".repeat(1000);
      const result = cm.enforceToolBudget("Test", output);
      assert.ok(result.length < output.length);
      assert.ok(result.includes("truncated"));
    });

    it("keeps head and tail of truncated output", () => {
      const cm = new ContextManager({ perTool: { Test: 10 } });
      const output = `HEAD${"x".repeat(1000)}TAIL`;
      const result = cm.enforceToolBudget("Test", output);
      assert.ok(result.startsWith("HEAD"));
      assert.ok(result.endsWith("TAIL"));
    });
  });

  describe("foldSubagentResult", () => {
    it("returns short output unchanged", () => {
      const cm = new ContextManager();
      assert.equal(cm.foldSubagentResult("agent-1", "short"), "short");
    });

    it("folds long output", () => {
      const cm = new ContextManager();
      const long = "A".repeat(5000);
      const folded = cm.foldSubagentResult("agent-1", long);
      assert.ok(folded.length < long.length);
      assert.ok(folded.includes("folded"));
      assert.ok(folded.includes("agent-1"));
    });

    it("respects autoFold setting", () => {
      const cm = new ContextManager({ autoFold: false });
      const long = "A".repeat(5000);
      assert.equal(cm.foldSubagentResult("agent-1", long), long);
    });
  });

  describe("estimateToolOutputTokens", () => {
    it("returns estimates for known tools", () => {
      const cm = new ContextManager();
      assert.ok(cm.estimateToolOutputTokens("Bash") > 0);
      assert.ok(cm.estimateToolOutputTokens("Read") > 0);
      assert.ok(cm.estimateToolOutputTokens("Agent") > cm.estimateToolOutputTokens("LS"));
    });

    it("returns default for unknown tools", () => {
      const cm = new ContextManager();
      assert.equal(cm.estimateToolOutputTokens("MysteryTool"), 1000);
    });
  });

  describe("config", () => {
    it("returns a copy of the budget", () => {
      const cm = new ContextManager({ toolOutputMax: 5000 });
      const config = cm.config;
      assert.equal(config.toolOutputMax, 5000);
    });

    it("autoFoldEnabled reflects setting", () => {
      assert.equal(new ContextManager({ autoFold: true }).autoFoldEnabled, true);
      assert.equal(new ContextManager({ autoFold: false }).autoFoldEnabled, false);
    });
  });
});
