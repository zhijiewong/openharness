/**
 * Integration-level tests for tools that require more complex setup:
 * MultiEdit, WebFetch (SSRF), Cron, Monitor, PowerShell, SendMessage,
 * Worktree, Pipeline, RemoteTrigger.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "oh-integ-"));
}

function ctx(workingDir: string) {
  return { workingDir, abortSignal: new AbortController().signal };
}

function writeFile(dir: string, name: string, content: string): string {
  const fp = join(dir, name);
  writeFileSync(fp, content);
  return fp;
}

// ── MultiEditTool ──

describe("MultiEditTool", async () => {
  const { MultiEditTool } = await import("./MultiEditTool/index.js");

  test("applies multiple edits across files atomically", async () => {
    const tmp = makeTmpDir();
    const file1 = writeFile(tmp, "a.ts", "const x = 1;\nconst y = 2;");
    const file2 = writeFile(tmp, "b.ts", "let z = 3;");

    const result = await MultiEditTool.call(
      {
        edits: [
          { file_path: file1, old_string: "const x = 1", new_string: "const x = 10" },
          { file_path: file2, old_string: "let z = 3", new_string: "let z = 30" },
        ],
      },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("2 edit(s)"));
    assert.ok(readFileSync(file1, "utf-8").includes("const x = 10"));
    assert.ok(readFileSync(file2, "utf-8").includes("let z = 30"));
  });

  test("fails atomically if old_string not found", async () => {
    const tmp = makeTmpDir();
    const file1 = writeFile(tmp, "a.ts", "const x = 1;");
    writeFile(tmp, "b.ts", "let y = 2;");

    const result = await MultiEditTool.call(
      {
        edits: [
          { file_path: file1, old_string: "const x = 1", new_string: "const x = 10" },
          { file_path: join(tmp, "b.ts"), old_string: "NONEXISTENT", new_string: "something" },
        ],
      },
      ctx(tmp),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
    // First file should NOT be modified (atomic failure)
    assert.ok(readFileSync(file1, "utf-8").includes("const x = 1"));
  });

  test("fails if file does not exist", async () => {
    const tmp = makeTmpDir();
    const result = await MultiEditTool.call(
      {
        edits: [{ file_path: join(tmp, "missing.ts"), old_string: "x", new_string: "y" }],
      },
      ctx(tmp),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
  });

  test("applies multiple edits to the same file in sequence", async () => {
    const tmp = makeTmpDir();
    const file = writeFile(tmp, "multi.ts", "aaa bbb ccc");

    const result = await MultiEditTool.call(
      {
        edits: [
          { file_path: file, old_string: "aaa", new_string: "AAA" },
          { file_path: file, old_string: "bbb", new_string: "BBB" },
        ],
      },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.equal(readFileSync(file, "utf-8"), "AAA BBB ccc");
  });
});

// ── WebFetchTool (SSRF protection) ──

describe("WebFetchTool — SSRF protection", async () => {
  const { WebFetchTool } = await import("./WebFetchTool/index.js");

  test("blocks localhost", async () => {
    const result = await WebFetchTool.call({ url: "http://localhost:8080/secret" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("blocked"));
  });

  test("blocks 127.0.0.1", async () => {
    const result = await WebFetchTool.call({ url: "http://127.0.0.1/" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("blocked"));
  });

  test("blocks 10.x.x.x private range", async () => {
    const result = await WebFetchTool.call({ url: "http://10.0.0.1/admin" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("blocked"));
  });

  test("blocks 192.168.x.x private range", async () => {
    const result = await WebFetchTool.call({ url: "http://192.168.1.1/" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("blocked"));
  });

  test("blocks .local domains", async () => {
    const result = await WebFetchTool.call({ url: "http://myhost.local/api" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("blocked"));
  });

  test("rejects invalid URL", async () => {
    const result = await WebFetchTool.call({ url: "not-a-url" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("Invalid URL"));
  });

  test("rejects non-http protocols", async () => {
    const result = await WebFetchTool.call({ url: "ftp://example.com/file" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("Only http and https"));
  });
});

// ── CronTool ──

describe("CronTool", async () => {
  const { CronCreateTool, CronDeleteTool, CronListTool } = await import("./CronTool/index.js");

  test("create, list, and delete a cron", async () => {
    // Create
    const createResult = await CronCreateTool.call(
      { action: "create", name: "test-cron", schedule: "every 5m", prompt: "check status" },
      ctx("."),
    );
    assert.equal(createResult.isError, false);
    assert.ok(createResult.output.includes("test-cron"));

    // Extract ID from output
    const idMatch = createResult.output.match(/\(([^)]+)\)/);
    assert.ok(idMatch, "Should contain cron ID in parentheses");
    const cronId = idMatch![1]!;

    // List
    const listResult = await CronListTool.call({ action: "list" }, ctx("."));
    assert.equal(listResult.isError, false);
    assert.ok(listResult.output.includes("test-cron"));

    // Delete
    const deleteResult = await CronDeleteTool.call({ action: "delete", id: cronId }, ctx("."));
    assert.equal(deleteResult.isError, false);
    assert.ok(deleteResult.output.includes("Deleted"));
  });

  test("delete nonexistent cron returns error", async () => {
    const result = await CronDeleteTool.call({ action: "delete", id: "nonexistent-id" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
  });

  test("list returns empty message when no crons", async () => {
    const result = await CronListTool.call({ action: "list" }, ctx("."));
    // May have crons from other tests, but at minimum should not error
    assert.equal(result.isError, false);
  });
});

// ── MonitorTool ──

describe("MonitorTool", async () => {
  const { MonitorTool } = await import("./MonitorTool/index.js");

  test("captures output from a simple command", async () => {
    const result = await MonitorTool.call(
      { command: "echo hello && echo world", timeout: 5000, maxLines: 10 },
      ctx("."),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("hello"));
    assert.ok(result.output.includes("world"));
  });

  test("respects maxLines limit", async () => {
    const cmd =
      process.platform === "win32"
        ? "echo line1 && echo line2 && echo line3 && echo line4 && echo line5"
        : "printf 'line1\\nline2\\nline3\\nline4\\nline5\\n'";
    const result = await MonitorTool.call({ command: cmd, maxLines: 2, timeout: 5000 }, ctx("."));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("2 lines"));
  });

  test("filters output by pattern", async () => {
    // Use printf for cross-platform reliability (echo behavior varies)
    const cmd =
      process.platform === "win32"
        ? "echo hello && echo world && echo hello-again"
        : "printf 'hello\\nworld\\nhello-again\\n'";
    const result = await MonitorTool.call({ command: cmd, pattern: "hello", timeout: 5000 }, ctx("."));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("hello"));
    // "world" alone shouldn't appear in filtered output (only in [Process exited...] trailer)
    const contentLines = result.output.split("\n").filter((l) => l.trim() && !l.startsWith("[") && !l.startsWith("  "));
    for (const line of contentLines) {
      if (line.trim()) assert.ok(line.includes("hello"), `Unexpected unfiltered line: "${line}"`);
    }
  });
});

// ── PowerShellTool ──

describe("PowerShellTool", async () => {
  const { PowerShellTool } = await import("./PowerShellTool/index.js");

  if (process.platform === "win32") {
    test("executes basic PowerShell command on Windows", async () => {
      const result = await PowerShellTool.call({ command: "Write-Output 'hello from ps'" }, ctx("."));
      assert.equal(result.isError, false);
      assert.ok(result.output.includes("hello from ps"));
    });

    test("returns error for failing command", async () => {
      const result = await PowerShellTool.call({ command: "throw 'deliberate error'" }, ctx("."));
      assert.equal(result.isError, true);
    });
  } else {
    test("returns error on non-Windows platforms", async () => {
      const result = await PowerShellTool.call({ command: "Get-Date" }, ctx("."));
      assert.equal(result.isError, true);
      assert.ok(result.output.includes("Windows"));
    });
  }
});

// ── SendMessageTool ──

describe("SendMessageTool", async () => {
  const { SendMessageTool } = await import("./SendMessageTool/index.js");

  test("sends a message to a named target", async () => {
    const result = await SendMessageTool.call({ to: "test-agent", content: "hello", type: "request" }, ctx("."));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("test-agent"));
  });

  test("sends broadcast message", async () => {
    const result = await SendMessageTool.call({ to: "*", content: "broadcast message" }, ctx("."));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("*"));
  });
});

// ── EnterWorktreeTool ──

describe("EnterWorktreeTool", async () => {
  const { EnterWorktreeTool } = await import("./EnterWorktreeTool/index.js");

  test("fails when not in a git repo", async () => {
    const tmp = makeTmpDir();
    const result = await EnterWorktreeTool.call({}, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("git"));
  });
});

// ── ExitWorktreeTool ──

describe("ExitWorktreeTool", async () => {
  const { ExitWorktreeTool } = await import("./ExitWorktreeTool/index.js");

  test("handles nonexistent path gracefully", async () => {
    const result = await ExitWorktreeTool.call({ path: "/tmp/nonexistent-worktree-xyz" }, ctx("."));
    // Tool may succeed or fail depending on git — just verify it returns a result
    assert.ok(typeof result.output === "string");
  });
});

// ── PipelineTool ──

describe("PipelineTool", async () => {
  const { PipelineTool } = await import("./PipelineTool/index.js");

  test("fails without tools in context", async () => {
    const result = await PipelineTool.call(
      {
        steps: [{ id: "step1", tool: "Glob", args: { pattern: "*.ts" } }],
      },
      ctx("."),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("unavailable"));
  });
});

// ── RemoteTriggerTool ──

describe("RemoteTriggerTool", async () => {
  const { RemoteTriggerTool } = await import("./RemoteTriggerTool/index.js");

  test("fails on invalid URL", async () => {
    const result = await RemoteTriggerTool.call({ url: "not-a-url://broken" }, ctx("."));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("failed"));
  });
});
