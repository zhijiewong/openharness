/**
 * Tests for hooks system — env var construction and hook matching.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import { invalidateConfigCache } from "./config.js";
import type { HookContext } from "./hooks.js";
import { emitHookAsync, invalidateHookCache } from "./hooks.js";

// Test the buildEnv function indirectly by importing and calling emitHook
// We can't test shell execution easily, but we CAN test the env var construction
// by examining the HookContext type coverage

describe("HookContext type coverage", () => {
  it("HookContext supports all new env var fields", () => {
    // Verify the type accepts all expected fields
    const ctx: HookContext = {
      toolName: "Bash",
      toolArgs: '{"command":"echo hi"}',
      toolOutput: "hi",
      toolInputJson: '{"command":"echo hi"}',
      sessionId: "test-123",
      model: "gpt-4o",
      provider: "openai",
      permissionMode: "ask",
      cost: "$0.0042",
      tokens: "1000↑ 500↓",
    };

    // All fields should be defined
    assert.equal(ctx.toolName, "Bash");
    assert.equal(ctx.sessionId, "test-123");
    assert.equal(ctx.model, "gpt-4o");
    assert.equal(ctx.provider, "openai");
    assert.equal(ctx.permissionMode, "ask");
    assert.equal(ctx.cost, "$0.0042");
    assert.equal(ctx.tokens, "1000↑ 500↓");
    assert.equal(ctx.toolInputJson, '{"command":"echo hi"}');
  });

  it("HookContext allows partial fields (all optional)", () => {
    const minimal: HookContext = {};
    assert.equal(minimal.toolName, undefined);
    assert.equal(minimal.sessionId, undefined);

    const withTool: HookContext = { toolName: "Read" };
    assert.equal(withTool.toolName, "Read");
    assert.equal(withTool.model, undefined);
  });
});

// ── Task 3: buildEnv env var mappings ──

function withTmpCwdAsync(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  return fn(dir).finally(() => {
    process.chdir(original);
    invalidateHookCache();
    invalidateConfigCache();
  });
}

/** Write a minimal .oh/config.yaml with a hook for the specified event. */
function writeHookConfig(dir: string, event: string, scriptPath: string) {
  mkdirSync(`${dir}/.oh`, { recursive: true });
  const body = [
    "provider: mock",
    "model: mock",
    "permissionMode: ask",
    "hooks:",
    `  ${event}:`,
    `    - command: "node ${JSON.stringify(scriptPath).slice(1, -1)}"`,
    "      jsonIO: false",
    "",
  ].join("\n");
  writeFileSync(`${dir}/.oh/config.yaml`, body);
  invalidateConfigCache();
  invalidateHookCache();
}

describe("buildEnv — new event fields (Task 3)", () => {
  it("OH_PROMPT carries userPromptSubmit prompt", async () => {
    await withTmpCwdAsync(async (dir) => {
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.txt`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         fs.writeFileSync('${outEsc}', process.env.OH_PROMPT ?? '');`,
      );
      writeHookConfig(dir, "userPromptSubmit", scriptPath);
      await emitHookAsync("userPromptSubmit", { prompt: "hello world" });
      const captured = readFileSync(outPath, "utf-8");
      assert.equal(captured, "hello world");
    });
  });

  it("OH_TOOL_ERROR carries postToolUseFailure toolError", async () => {
    await withTmpCwdAsync(async (dir) => {
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.txt`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         fs.writeFileSync('${outEsc}', process.env.OH_TOOL_ERROR ?? '');`,
      );
      writeHookConfig(dir, "postToolUseFailure", scriptPath);
      await emitHookAsync("postToolUseFailure", { toolName: "Bash", toolError: "TimeoutError" });
      const captured = readFileSync(outPath, "utf-8");
      assert.equal(captured, "TimeoutError");
    });
  });

  it("OH_ERROR_MESSAGE carries postToolUseFailure errorMessage", async () => {
    await withTmpCwdAsync(async (dir) => {
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.txt`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         fs.writeFileSync('${outEsc}', process.env.OH_ERROR_MESSAGE ?? '');`,
      );
      writeHookConfig(dir, "postToolUseFailure", scriptPath);
      await emitHookAsync("postToolUseFailure", { toolName: "Bash", errorMessage: "command failed with exit 1" });
      const captured = readFileSync(outPath, "utf-8");
      assert.equal(captured, "command failed with exit 1");
    });
  });

  it("OH_PERMISSION_ACTION carries permissionRequest permissionAction", async () => {
    await withTmpCwdAsync(async (dir) => {
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.txt`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         fs.writeFileSync('${outEsc}', process.env.OH_PERMISSION_ACTION ?? '');`,
      );
      writeHookConfig(dir, "permissionRequest", scriptPath);
      await emitHookAsync("permissionRequest", { toolName: "Bash", permissionAction: "ask" });
      const captured = readFileSync(outPath, "utf-8");
      assert.equal(captured, "ask");
    });
  });

  it("OH_PROMPT is truncated to 8KB", async () => {
    await withTmpCwdAsync(async (dir) => {
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.txt`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         fs.writeFileSync('${outEsc}', process.env.OH_PROMPT ?? '');`,
      );
      writeHookConfig(dir, "userPromptSubmit", scriptPath);
      const longPrompt = "x".repeat(10_000);
      await emitHookAsync("userPromptSubmit", { prompt: longPrompt });
      const captured = readFileSync(outPath, "utf-8");
      // 8KB = 8192 chars
      assert.equal(captured.length, 8192);
      assert.equal(captured, "x".repeat(8192));
    });
  });
});
