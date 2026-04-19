/**
 * Tests for postToolUse / postToolUseFailure mutual exclusion in executeSingleTool.
 *
 * Strategy: invoke executeSingleTool directly with controlled mock tools, capturing
 * hook emissions via the filesystem hook-script mechanism (same pattern as hooks.test.ts).
 * Each test writes a tiny .oh/config.yaml that registers shell hooks for the events
 * under test; hooks append the event name to a capture file. After execution we wait a
 * short tick so the fire-and-forget hooks flush, then read the capture file.
 *
 * We cannot easily monkey-patch ESM exports, so the filesystem approach is the most
 * reliable way to observe which hook events fired.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { z } from "zod";
import { invalidateConfigCache } from "../harness/config.js";
import { invalidateHookCache } from "../harness/hooks.js";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { makeTmpDir } from "../test-helpers.js";
import { executeSingleTool } from "./tools.js";

// ── helpers ────────────────────────────────────────────────────────────────

/** Minimal ToolContext for tests — no git, no streaming output. */
function makeContext(): ToolContext {
  return {
    workingDir: process.cwd(),
    gitCommitPerTool: false,
  };
}

/** Build a minimal mock Tool whose call() returns a fixed ToolResult. */
function makeTool(name: string, result: ToolResult): Tool {
  return {
    name,
    description: "test tool",
    inputSchema: z.object({ input: z.string().optional() }),
    riskLevel: "low",
    isReadOnly() {
      return true;
    },
    isConcurrencySafe() {
      return true;
    },
    async call(): Promise<ToolResult> {
      return result;
    },
    prompt() {
      return name;
    },
  };
}

/** Build a mock Tool whose call() throws. */
function makeThrowingTool(name: string, message: string): Tool {
  return {
    name,
    description: "throwing test tool",
    inputSchema: z.object({ input: z.string().optional() }),
    riskLevel: "low",
    isReadOnly() {
      return true;
    },
    isConcurrencySafe() {
      return true;
    },
    async call(): Promise<ToolResult> {
      throw new Error(message);
    },
    prompt() {
      return name;
    },
  };
}

/**
 * Write an .oh/config.yaml in `dir` that registers hook commands for the given
 * events. Each command appends "<eventName>\n" to the capture file at capturePath.
 * We write a small .cjs helper script that appends the event name to avoid
 * complex quoting in the YAML/shell command string.
 */
function writeHookConfig(dir: string, capturePath: string, events: Array<"postToolUse" | "postToolUseFailure">): void {
  mkdirSync(`${dir}/.oh`, { recursive: true });

  const lines = ["provider: mock", "model: mock", "permissionMode: trust", "hooks:"];
  for (const e of events) {
    // Write a dedicated .cjs capture script for this event to avoid shell quoting issues.
    const scriptPath = `${dir}/capture-${e}.cjs`;
    const capturePathFwd = capturePath.replace(/\\/g, "/");
    writeFileSync(
      scriptPath,
      `require('node:fs').appendFileSync(${JSON.stringify(capturePathFwd)}, ${JSON.stringify(`${e}\n`)});`,
    );
    const scriptPathFwd = scriptPath.replace(/\\/g, "/");
    lines.push(`  ${e}:`);
    lines.push(`    - command: 'node ${scriptPathFwd}'`);
  }
  lines.push("");
  writeFileSync(`${dir}/.oh/config.yaml`, lines.join("\n"));
}

/**
 * Run `fn` inside a temporary cwd that has hooks configured for `events`.
 * Returns the list of event names that fired (in order) and the tool result.
 */
async function withHookCapture<T>(
  events: Array<"postToolUse" | "postToolUseFailure">,
  fn: () => Promise<T>,
): Promise<{ fired: string[]; result: T }> {
  const dir = makeTmpDir();
  const capturePath = `${dir}/captured.log`;
  const original = process.cwd();
  process.chdir(dir);
  try {
    writeHookConfig(dir, capturePath, events);
    invalidateConfigCache();
    invalidateHookCache();

    const result = await fn();

    // Yield so fire-and-forget async hook processes can write to the capture file.
    await new Promise<void>((r) => setTimeout(r, 150));

    const fired = existsSync(capturePath) ? readFileSync(capturePath, "utf8").split("\n").filter(Boolean) : [];

    return { fired, result };
  } finally {
    process.chdir(original);
    invalidateHookCache();
    invalidateConfigCache();
  }
}

// ── ToolCall stub ────────────────────────────────────────────────────────────

function makeToolCall(toolName: string, args: Record<string, unknown> = {}) {
  return { toolName, arguments: args, id: "test-call-1" };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("tools.ts — postToolUse / postToolUseFailure mutual exclusion", () => {
  it("successful tool (isError: false) fires postToolUse ONLY — not postToolUseFailure", async () => {
    const tool = makeTool("SuccessTool", { output: "all good", isError: false });
    const toolCall = makeToolCall("SuccessTool");

    const { fired, result } = await withHookCapture(["postToolUse", "postToolUseFailure"], () =>
      executeSingleTool(toolCall, [tool], makeContext(), "trust"),
    );

    assert.equal(result.isError, false, "tool result should be success");
    assert.deepEqual(fired, ["postToolUse"], "only postToolUse should fire on success");
  });

  it("tool returning isError:true fires postToolUseFailure ONLY — not postToolUse", async () => {
    const tool = makeTool("ErrorTool", { output: "bad input detected", isError: true });
    const toolCall = makeToolCall("ErrorTool");

    const { fired, result } = await withHookCapture(["postToolUse", "postToolUseFailure"], () =>
      executeSingleTool(toolCall, [tool], makeContext(), "trust"),
    );

    assert.equal(result.isError, true, "tool result should be error");
    assert.deepEqual(
      fired,
      ["postToolUseFailure"],
      "only postToolUseFailure should fire when tool returns isError:true",
    );
  });

  it("throwing tool fires postToolUseFailure ONLY — not postToolUse", async () => {
    const tool = makeThrowingTool("ThrowingTool", "unexpected crash");
    const toolCall = makeToolCall("ThrowingTool");

    const { fired, result } = await withHookCapture(["postToolUse", "postToolUseFailure"], () =>
      executeSingleTool(toolCall, [tool], makeContext(), "trust"),
    );

    assert.equal(result.isError, true, "throw should surface as isError:true");
    assert.ok(result.output.includes("unexpected crash"), "error message should be in output");
    assert.deepEqual(fired, ["postToolUseFailure"], "only postToolUseFailure should fire when tool throws");
  });

  it("hooks are independent — both fire when configured for both event paths", async () => {
    // Run both a success and an error tool in sequence to confirm each fires
    // the correct hook without cross-contamination.
    const successTool = makeTool("SuccessA", { output: "ok", isError: false });
    const errorTool = makeTool("ErrorB", { output: "fail", isError: true });

    const dir = makeTmpDir();
    const capturePath = `${dir}/captured.log`;
    const original = process.cwd();
    process.chdir(dir);
    try {
      writeHookConfig(dir, capturePath, ["postToolUse", "postToolUseFailure"]);
      invalidateConfigCache();
      invalidateHookCache();

      await executeSingleTool(makeToolCall("SuccessA"), [successTool], makeContext(), "trust");
      await executeSingleTool(makeToolCall("ErrorB"), [errorTool], makeContext(), "trust");

      await new Promise<void>((r) => setTimeout(r, 200));

      const fired = existsSync(capturePath) ? readFileSync(capturePath, "utf8").split("\n").filter(Boolean) : [];

      // SuccessA → postToolUse, ErrorB → postToolUseFailure
      assert.equal(fired.length, 2, "exactly two hook events should have fired");
      assert.equal(fired[0], "postToolUse", "first event should be postToolUse (success)");
      assert.equal(fired[1], "postToolUseFailure", "second event should be postToolUseFailure (error)");
    } finally {
      process.chdir(original);
      invalidateHookCache();
      invalidateConfigCache();
    }
  });
});
