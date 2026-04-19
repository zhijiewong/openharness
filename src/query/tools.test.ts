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

// ── permissionRequest helpers ────────────────────────────────────────────────

/**
 * Build a mock Tool that triggers the needs-approval branch:
 * - riskLevel "high" + isReadOnly() false so "ask" mode won't auto-approve.
 * - call() returns the provided ToolResult.
 */
function makeNeedsApprovalTool(name: string, result: ToolResult): Tool {
  return {
    name,
    description: "needs-approval test tool",
    inputSchema: z.object({ input: z.string().optional() }),
    riskLevel: "high",
    isReadOnly() {
      return false;
    },
    isConcurrencySafe() {
      return false;
    },
    async call(): Promise<ToolResult> {
      return result;
    },
    prompt() {
      return name;
    },
  };
}

/**
 * Write .oh/config.yaml in `dir` with:
 * - permissionMode: ask  (so checkPermission returns needs-approval)
 * - a permissionRequest hook that writes `hookJson` JSON to stdout, using jsonIO.
 *
 * When `hookJson` is null, no permissionRequest hook is configured.
 */
function writePermHookConfig(dir: string, hookJson: Record<string, unknown> | null): void {
  mkdirSync(`${dir}/.oh`, { recursive: true });

  const lines = ["provider: mock", "model: mock", "permissionMode: ask"];

  if (hookJson !== null) {
    // Write a .cjs hook script that prints the decision JSON to stdout then exits 0.
    const scriptPath = `${dir}/perm-hook.cjs`;
    const scriptPathFwd = scriptPath.replace(/\\/g, "/");
    writeFileSync(scriptPath, `process.stdout.write(${JSON.stringify(JSON.stringify(hookJson))});\n`);
    lines.push("hooks:");
    lines.push("  permissionRequest:");
    lines.push(`    - command: 'node ${scriptPathFwd}'`);
    lines.push("      jsonIO: true");
  }

  lines.push("");
  writeFileSync(`${dir}/.oh/config.yaml`, lines.join("\n"));
}

/**
 * Run `fn` inside a temporary cwd configured for permissionRequest hook testing.
 * Returns the tool result and the askUser invocation counter.
 */
async function withPermHook<T>(
  hookJson: Record<string, unknown> | null,
  fn: (askUserCounter: { count: number }) => Promise<T>,
): Promise<{ result: T; askUserCount: number }> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    writePermHookConfig(dir, hookJson);
    invalidateConfigCache();
    invalidateHookCache();

    const counter = { count: 0 };
    const result = await fn(counter);

    return { result, askUserCount: counter.count };
  } finally {
    process.chdir(original);
    invalidateHookCache();
    invalidateConfigCache();
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("tools.ts — permissionRequest hook", () => {
  it("hook 'allow' skips askUser and executes tool", async () => {
    const tool = makeNeedsApprovalTool("ApprovalTool", { output: "executed", isError: false });
    const toolCall = makeToolCall("ApprovalTool");

    const { result, askUserCount } = await withPermHook({ hookSpecificOutput: { decision: "allow" } }, (counter) => {
      const askUser = async () => {
        counter.count++;
        return true;
      };
      return executeSingleTool(toolCall, [tool], makeContext(), "ask", askUser);
    });

    assert.equal(askUserCount, 0, "askUser must NOT be called when hook says allow");
    assert.equal(result.isError, false, "tool should have executed normally");
    assert.ok(result.output.includes("executed"), "tool output should be returned");
  });

  it("hook 'deny' returns permission-denied without calling askUser", async () => {
    const tool = makeNeedsApprovalTool("DenyTool", { output: "executed", isError: false });
    const toolCall = makeToolCall("DenyTool");

    const { result, askUserCount } = await withPermHook(
      { hookSpecificOutput: { decision: "deny", reason: "no way" } },
      (counter) => {
        const askUser = async () => {
          counter.count++;
          return true;
        };
        return executeSingleTool(toolCall, [tool], makeContext(), "ask", askUser);
      },
    );

    assert.equal(askUserCount, 0, "askUser must NOT be called when hook says deny");
    assert.equal(result.isError, true, "result should be an error");
    assert.ok(
      /Permission denied.*no way/.test(result.output),
      `output should mention denial reason, got: ${result.output}`,
    );
  });

  it("hook 'ask' falls through to askUser", async () => {
    const tool = makeNeedsApprovalTool("AskTool", { output: "executed", isError: false });
    const toolCall = makeToolCall("AskTool");

    const { result, askUserCount } = await withPermHook({ hookSpecificOutput: { decision: "ask" } }, (counter) => {
      const askUser = async () => {
        counter.count++;
        return true; // user approves
      };
      return executeSingleTool(toolCall, [tool], makeContext(), "ask", askUser);
    });

    assert.equal(askUserCount, 1, "askUser MUST be called when hook says ask");
    assert.equal(result.isError, false, "tool should execute after user approves");
  });

  it("no hook configured falls through to askUser", async () => {
    const tool = makeNeedsApprovalTool("NoHookTool", { output: "executed", isError: false });
    const toolCall = makeToolCall("NoHookTool");

    const { result, askUserCount } = await withPermHook(
      null, // no permissionRequest hook
      (counter) => {
        const askUser = async () => {
          counter.count++;
          return true;
        };
        return executeSingleTool(toolCall, [tool], makeContext(), "ask", askUser);
      },
    );

    assert.equal(askUserCount, 1, "askUser MUST be called when no hook is configured");
    assert.equal(result.isError, false, "tool should execute after user approves");
  });

  it("malformed hook response falls through to askUser (conservative)", async () => {
    const tool = makeNeedsApprovalTool("MalformedTool", { output: "executed", isError: false });
    const toolCall = makeToolCall("MalformedTool");

    // Hook writes garbage — no valid permissionDecision can be parsed
    const { result, askUserCount } = await withPermHook(
      { someOtherField: "garbage", noDecisionHere: 42 },
      (counter) => {
        const askUser = async () => {
          counter.count++;
          return true;
        };
        return executeSingleTool(toolCall, [tool], makeContext(), "ask", askUser);
      },
    );

    assert.equal(askUserCount, 1, "askUser MUST be called when hook response has no decision");
    assert.equal(result.isError, false, "tool should execute after user approves");
  });
});

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

      // Poll for both fire-and-forget hook processes to flush their stdout to
      // the capture file. On slow CI runners, a fixed wait is too short.
      const deadline = Date.now() + 5_000;
      let fired: string[] = [];
      while (Date.now() < deadline) {
        fired = existsSync(capturePath) ? readFileSync(capturePath, "utf8").split("\n").filter(Boolean) : [];
        if (fired.length >= 2) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      // Child-process write order is NOT guaranteed across the two
      // executeSingleTool calls — assert set-membership instead of array order.
      fired = [...fired].sort();

      // SuccessA → postToolUse fires for the success call.
      // ErrorB → postToolUseFailure fires for the failure call.
      // Exactly two events, one of each kind (order-independent).
      assert.equal(fired.length, 2, "exactly two hook events should have fired");
      assert.deepEqual(fired, ["postToolUse", "postToolUseFailure"], "both hook events should have fired exactly once");
    } finally {
      process.chdir(original);
      invalidateHookCache();
      invalidateConfigCache();
    }
  });
});
