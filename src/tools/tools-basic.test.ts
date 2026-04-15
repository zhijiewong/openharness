/**
 * Basic happy-path tests for all tools.
 * Uses node:test + node:assert/strict.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ToolContext } from "../Tool.js";
import { createMockTool, makeTmpDir, mockFetch, writeFile } from "../test-helpers.js";
import { AgentTool } from "./AgentTool/index.js";
import { AskUserTool } from "./AskUserTool/index.js";
// Tool imports
import { BashTool } from "./BashTool/index.js";
import { DiagnosticsTool } from "./DiagnosticsTool/index.js";
import { EnterPlanModeTool } from "./EnterPlanModeTool/index.js";
import { ExitPlanModeTool } from "./ExitPlanModeTool/index.js";
import { FileReadTool } from "./FileReadTool/index.js";
import { FileWriteTool } from "./FileWriteTool/index.js";
import { GlobTool } from "./GlobTool/index.js";
import { GrepTool } from "./GrepTool/index.js";
import { ImageReadTool } from "./ImageReadTool/index.js";
import { LSTool } from "./LSTool/index.js";
import { NotebookEditTool } from "./NotebookEditTool/index.js";
import { ParallelAgentTool } from "./ParallelAgentTool/index.js";
import { SkillTool } from "./SkillTool/index.js";
import { TaskCreateTool } from "./TaskCreateTool/index.js";
import { TaskGetTool } from "./TaskGetTool/index.js";
import { TaskListTool } from "./TaskListTool/index.js";
import { TaskOutputTool } from "./TaskOutputTool/index.js";
import { TaskStopTool } from "./TaskStopTool/index.js";
import { TaskUpdateTool } from "./TaskUpdateTool/index.js";
import { ToolSearchTool } from "./ToolSearchTool/index.js";
import { WebSearchTool } from "./WebSearchTool/index.js";

function ctx(tmpdir: string, extra: Partial<ToolContext> = {}): ToolContext {
  return { workingDir: tmpdir, ...extra };
}

describe("tools-basic", () => {
  let cleanupFetch: (() => void) | null = null;
  afterEach(() => {
    if (cleanupFetch) {
      cleanupFetch();
      cleanupFetch = null;
    }
  });

  it("BashTool — echo hello", async () => {
    const tmp = makeTmpDir();
    const result = await BashTool.call({ command: "echo hello" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("hello"));
  });

  it("FileReadTool — reads file contents", async () => {
    const tmp = makeTmpDir();
    const filePath = writeFile(tmp, "read-me.txt", "greetings from file");
    const result = await FileReadTool.call({ file_path: filePath }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("greetings from file"));
  });

  it("FileWriteTool — writes a file", async () => {
    const tmp = makeTmpDir();
    const filePath = join(tmp, "output.txt");
    const result = await FileWriteTool.call({ file_path: filePath, content: "test content" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes(filePath));
  });

  it("GlobTool — finds files by pattern", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "alpha.txt", "a");
    writeFile(tmp, "beta.txt", "b");
    writeFile(tmp, "gamma.js", "c");
    const result = await GlobTool.call({ pattern: "*.txt", path: tmp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("alpha.txt"));
    assert.ok(result.output.includes("beta.txt"));
    assert.ok(!result.output.includes("gamma.js"));
  });

  it("GrepTool — searches file contents", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "haystack.txt", "hello world\ngoodbye world");
    const result = await GrepTool.call({ pattern: "hello", path: tmp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("haystack.txt"));
  });

  it("LSTool — lists directory contents", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "one.txt", "1");
    writeFile(tmp, "two.txt", "2");
    const result = await LSTool.call({ path: tmp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("one.txt"));
    assert.ok(result.output.includes("two.txt"));
  });

  it("WebSearchTool — returns results with mocked fetch", async () => {
    const html = `
      <a class="result__a" href="?uddg=https%3A%2F%2Fexample.com">Example</a>
      <a class="result__snippet">A snippet</a>
    `;
    cleanupFetch = mockFetch(async () => new Response(html, { status: 200 }));
    const tmp = makeTmpDir();
    const result = await WebSearchTool.call({ query: "test" }, ctx(tmp));
    assert.equal(result.isError, false);
  });

  it("TaskCreateTool — creates a task", async () => {
    const tmp = makeTmpDir();
    const result = await TaskCreateTool.call({ subject: "test task", description: "a test description" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Task #1"));
  });

  it("TaskUpdateTool — updates an existing task", async () => {
    const tmp = makeTmpDir();
    // Create a task first
    await TaskCreateTool.call({ subject: "task to update", description: "original desc" }, ctx(tmp));
    const result = await TaskUpdateTool.call({ taskId: 1, status: "completed" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("completed"));
  });

  it("TaskListTool — lists tasks", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "listed task", description: "desc" }, ctx(tmp));
    const result = await TaskListTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("listed task"));
  });

  it("AskUserTool — headless fallback", async () => {
    const tmp = makeTmpDir();
    const result = await AskUserTool.call({ question: "What color?" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("What color?"));
  });

  it("SkillTool — list skills (empty is OK)", async () => {
    const tmp = makeTmpDir();
    const result = await SkillTool.call({ skill: "list" }, ctx(tmp));
    assert.equal(result.isError, false);
  });

  it("AgentTool — errors without provider in context", async () => {
    const tmp = makeTmpDir();
    const result = await AgentTool.call({ prompt: "do something" }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("unavailable"));
  });

  it("EnterPlanModeTool — creates plan file in .oh/plans/", async () => {
    const tmp = makeTmpDir();
    const result = await EnterPlanModeTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Plan mode entered"));
    assert.ok(result.output.includes(".oh"));
    assert.ok(result.output.includes("plans"));
    // Verify file was actually created
    const { readdirSync } = await import("node:fs");
    const plansDir = join(tmp, ".oh", "plans");
    const files = readdirSync(plansDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith(".md"));
    // Verify filename matches adjective-verb-noun pattern
    const name = files[0].replace(".md", "");
    assert.ok(name.split("-").length === 3, `Expected 3-part name, got: ${name}`);
  });

  it("ExitPlanModeTool — exits plan mode", async () => {
    const tmp = makeTmpDir();
    const result = await ExitPlanModeTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Plan mode exited"));
  });

  it("ExitPlanModeTool — accepts allowedPrompts", async () => {
    const tmp = makeTmpDir();
    const result = await ExitPlanModeTool.call(
      {
        allowedPrompts: [
          { tool: "Bash" as const, prompt: "run tests" },
          { tool: "Bash" as const, prompt: "install dependencies" },
        ],
      },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("run tests"));
    assert.ok(result.output.includes("install dependencies"));
  });

  it("NotebookEditTool — edits a notebook cell", async () => {
    const tmp = makeTmpDir();
    const notebook = {
      cells: [{ cell_type: "code", source: ["print('old')"], metadata: {}, outputs: [] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    };
    writeFile(tmp, "test.ipynb", JSON.stringify(notebook));
    const result = await NotebookEditTool.call(
      { notebook_path: "test.ipynb", cell_index: 0, new_source: "print('new')" },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Cell 0 updated"));
  });

  it("ImageReadTool — errors on non-image file", async () => {
    const tmp = makeTmpDir();
    const filePath = writeFile(tmp, "test.txt", "not an image");
    const result = await ImageReadTool.call({ file_path: filePath }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("Unsupported image type"));
  });

  it("DiagnosticsTool — errors without LSP server", async () => {
    const tmp = makeTmpDir();
    const result = await DiagnosticsTool.call({ file_path: "/nonexistent/file.txt", action: "diagnostics" }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("No language server"));
  });

  it("ParallelAgentTool — errors without provider in context", async () => {
    const tmp = makeTmpDir();
    const result = await ParallelAgentTool.call({ tasks: [{ id: "a", prompt: "test" }] }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("unavailable"));
  });

  it("ToolSearchTool — finds a mock tool by name", async () => {
    const tmp = makeTmpDir();
    const mock = createMockTool("MockAlpha");
    const result = await ToolSearchTool.call({ query: "Mock", maxResults: 5 }, ctx(tmp, { tools: [mock] }));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("MockAlpha"));
  });

  // ── TaskGetTool ──

  it("TaskGetTool — gets a task by ID", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "get me", description: "desc" }, ctx(tmp));
    const result = await TaskGetTool.call({ taskId: 1 }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("get me"));
    assert.ok(result.output.includes("pending"));
  });

  it("TaskGetTool — errors on missing task", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "x", description: "y" }, ctx(tmp));
    const result = await TaskGetTool.call({ taskId: 99 }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
  });

  // ── TaskStopTool ──

  it("TaskStopTool — cancels a pending task", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "cancel me", description: "d" }, ctx(tmp));
    const result = await TaskStopTool.call({ taskId: 1, reason: "no longer needed" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("cancelled"));
    // Verify it's actually cancelled
    const get = await TaskGetTool.call({ taskId: 1 }, ctx(tmp));
    assert.ok(get.output.includes("cancelled"));
  });

  it("TaskStopTool — no-op on already completed task", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "done", description: "d" }, ctx(tmp));
    await TaskUpdateTool.call({ taskId: 1, status: "completed" }, ctx(tmp));
    const result = await TaskStopTool.call({ taskId: 1 }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("already completed"));
  });

  // ── TaskOutputTool ──

  it("TaskOutputTool — saves output to a task", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "output me", description: "d" }, ctx(tmp));
    const result = await TaskOutputTool.call({ taskId: 1, output: "result data" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("saved"));
    // Verify output is stored
    const get = await TaskGetTool.call({ taskId: 1 }, ctx(tmp));
    assert.ok(get.output.includes("result data"));
  });

  // ── TaskUpdate enhanced fields ──

  it("TaskUpdateTool — deletes a task", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "delete me", description: "d" }, ctx(tmp));
    const result = await TaskUpdateTool.call({ taskId: 1, status: "deleted" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("deleted"));
    // Verify it's gone
    const list = await TaskListTool.call({}, ctx(tmp));
    assert.ok(!list.output.includes("delete me"));
  });

  it("TaskUpdateTool — sets blocks/blockedBy", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call({ subject: "first", description: "d" }, ctx(tmp));
    await TaskCreateTool.call({ subject: "second", description: "d" }, ctx(tmp));
    const result = await TaskUpdateTool.call({ taskId: 2, addBlockedBy: [1] }, ctx(tmp));
    assert.equal(result.isError, false);
  });

  // ── TaskCreate with activeForm ──

  it("TaskCreateTool — creates with activeForm", async () => {
    const tmp = makeTmpDir();
    const result = await TaskCreateTool.call(
      { subject: "build it", description: "d", activeForm: "Building it" },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Task #1"));
  });

  // ── GrepTool output modes ──

  it("GrepTool — output_mode files_with_matches (default)", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "a.txt", "hello world");
    writeFile(tmp, "b.txt", "goodbye world");
    const result = await GrepTool.call({ pattern: "hello", path: tmp, output_mode: "files_with_matches" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("a.txt"));
    assert.ok(!result.output.includes("b.txt"));
  });

  it("GrepTool — output_mode content shows matching lines", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "c.txt", "line one\nline two\nline three");
    const result = await GrepTool.call({ pattern: "two", path: tmp, output_mode: "content" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("line two"));
  });

  it("GrepTool — output_mode count", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "d.txt", "aaa\naaa\nbbb");
    const result = await GrepTool.call({ pattern: "aaa", path: tmp, output_mode: "count" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("2"));
  });

  it("GrepTool — type filter", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "code.ts", "const x = 1;");
    writeFile(tmp, "style.css", "const y = 2;");
    const result = await GrepTool.call({ pattern: "const", path: tmp, type: "ts" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("code.ts"));
    assert.ok(!result.output.includes("style.css"));
  });

  it("GrepTool — case insensitive", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "e.txt", "Hello World");
    const result = await GrepTool.call({ pattern: "hello", path: tmp, "-i": true }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("e.txt"));
  });

  it("GrepTool — head_limit", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "f1.txt", "match");
    writeFile(tmp, "f2.txt", "match");
    writeFile(tmp, "f3.txt", "match");
    const result = await GrepTool.call({ pattern: "match", path: tmp, head_limit: 2 }, ctx(tmp));
    assert.equal(result.isError, false);
    const fileCount = result.output.split("\n").filter((l) => l.trim()).length;
    assert.ok(fileCount <= 2);
  });

  // ── LSTool depth ──

  it("LSTool — depth 1 (default) shows only immediate contents", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "top.txt", "t");
    writeFile(tmp, "sub/nested.txt", "n");
    const result = await LSTool.call({ path: tmp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("top.txt"));
    assert.ok(result.output.includes("sub/"));
    assert.ok(!result.output.includes("nested.txt"));
  });

  it("LSTool — depth 2 shows nested files", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "top.txt", "t");
    writeFile(tmp, "sub/nested.txt", "n");
    const result = await LSTool.call({ path: tmp, depth: 2 }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("top.txt"));
    assert.ok(result.output.includes("nested.txt"));
  });

  // ── FileReadTool — notebook ──

  it("FileReadTool — reads Jupyter notebook cells", async () => {
    const tmp = makeTmpDir();
    const nb = {
      cells: [
        { cell_type: "code", source: ["print('hi')"], outputs: [{ text: ["hi\n"] }] },
        { cell_type: "markdown", source: ["# Title"], outputs: [] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    };
    const fp = writeFile(tmp, "test.ipynb", JSON.stringify(nb));
    const result = await FileReadTool.call({ file_path: fp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("print('hi')"));
    assert.ok(result.output.includes("# Title"));
    assert.ok(result.output.includes("[Output]"));
  });

  // ── FileReadTool — image ──

  it("FileReadTool — returns base64 for PNG files", async () => {
    const tmp = makeTmpDir();
    // Write a minimal PNG header
    const { writeFileSync: wfs } = await import("node:fs");
    const fp = join(tmp, "tiny.png");
    wfs(fp, Buffer.from("89504e470d0a1a0a", "hex"));
    const result = await FileReadTool.call({ file_path: fp }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.startsWith("__IMAGE__:image/png:"));
  });

  // ── FileWriteTool — overwrite detection ──

  it("FileWriteTool — reports Created for new file", async () => {
    const tmp = makeTmpDir();
    const fp = join(tmp, "new.txt");
    const result = await FileWriteTool.call({ file_path: fp, content: "new" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Created"));
  });

  it("FileWriteTool — reports Overwrote for existing file", async () => {
    const tmp = makeTmpDir();
    const fp = writeFile(tmp, "existing.txt", "old");
    const result = await FileWriteTool.call({ file_path: fp, content: "new" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Overwrote"));
  });

  // ── ScheduleWakeupTool ──

  it("ScheduleWakeupTool — schedules a wakeup and clamps delay", async () => {
    const { ScheduleWakeupTool, consumeWakeup, cancelWakeup } = await import("./ScheduleWakeupTool/index.js");
    const tmp = makeTmpDir();

    // Schedule a wakeup with delay under minimum (should clamp to 60)
    const result = await ScheduleWakeupTool.call(
      {
        delaySeconds: 10,
        reason: "checking build",
        prompt: "check build status",
      },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("60s"));
    assert.ok(result.output.includes("checking build"));

    // Consume the wakeup
    const wakeup = consumeWakeup();
    assert.ok(wakeup);
    assert.equal(wakeup!.delaySeconds, 60);
    assert.equal(wakeup!.prompt, "check build status");

    // Second consume returns null (already consumed)
    assert.equal(consumeWakeup(), null);
  });

  it("ScheduleWakeupTool — clamps delay to max 3600", async () => {
    const { ScheduleWakeupTool, consumeWakeup } = await import("./ScheduleWakeupTool/index.js");
    const tmp = makeTmpDir();
    await ScheduleWakeupTool.call(
      {
        delaySeconds: 9999,
        reason: "long wait",
        prompt: "check again",
      },
      ctx(tmp),
    );
    const wakeup = consumeWakeup();
    assert.ok(wakeup);
    assert.equal(wakeup!.delaySeconds, 3600);
  });

  it("ScheduleWakeupTool — cache warning for 300s boundary", async () => {
    const { ScheduleWakeupTool, consumeWakeup } = await import("./ScheduleWakeupTool/index.js");
    const tmp = makeTmpDir();
    const result = await ScheduleWakeupTool.call(
      {
        delaySeconds: 300,
        reason: "boundary test",
        prompt: "test",
      },
      ctx(tmp),
    );
    assert.ok(result.output.includes("cache TTL boundary") || result.output.includes("warning"));
    consumeWakeup(); // cleanup
  });

  // ── suggestDelay utility ──

  it("suggestDelay — short wait stays in cache window", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    const delay = suggestDelay(120);
    assert.ok(delay >= 60 && delay <= 270, `Expected 60-270, got ${delay}`);
  });

  it("suggestDelay — avoids 300s boundary", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    const delay = suggestDelay(300);
    assert.equal(delay, 270, "Should drop to 270 to avoid cache boundary");
  });

  it("suggestDelay — idle polling returns 1200", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    const delay = suggestDelay(0, true);
    assert.equal(delay, 1200);
  });

  it("suggestDelay — long wait capped at 3600", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    const delay = suggestDelay(9999);
    assert.equal(delay, 3600);
  });

  it("ScheduleWakeupTool — output shows cache zone label", async () => {
    const { ScheduleWakeupTool, consumeWakeup } = await import("./ScheduleWakeupTool/index.js");
    const tmp = makeTmpDir();
    const result = await ScheduleWakeupTool.call(
      {
        delaySeconds: 120,
        reason: "checking CI",
        prompt: "check CI",
      },
      ctx(tmp),
    );
    assert.ok(result.output.includes("cache:warm"));
    consumeWakeup();
  });

  // ── Agent Continuation Registry ──

  it("AgentMessageBus — registers and completes background agents", async () => {
    const { AgentMessageBus } = await import("../services/agent-messaging.js");
    const bus = new AgentMessageBus();

    bus.registerBackgroundAgent("bg-1", "code-reviewer");
    const agent = bus.getBackgroundAgent("bg-1");
    assert.ok(agent);
    assert.equal(agent!.status, "running");
    assert.equal(agent!.role, "code-reviewer");

    // Send message to background agent
    assert.equal(bus.sendToBackgroundAgent("bg-1", "how's it going?"), true);
    assert.equal(bus.sendToBackgroundAgent("bg-999", "hello"), false);

    // Drain messages
    const msgs = bus.drainBackgroundMessages("bg-1");
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0], "how's it going?");
    assert.equal(bus.drainBackgroundMessages("bg-1").length, 0);

    // Complete the agent
    bus.completeBackgroundAgent("bg-1", "review done");
    const completed = bus.getBackgroundAgent("bg-1");
    assert.equal(completed!.status, "completed");
    assert.equal(completed!.result, "review done");
    assert.ok(completed!.completedAt);
  });

  it("AgentMessageBus — errors background agents", async () => {
    const { AgentMessageBus } = await import("../services/agent-messaging.js");
    const bus = new AgentMessageBus();

    bus.registerBackgroundAgent("bg-err", "debugger");
    bus.errorBackgroundAgent("bg-err", "timeout");
    const agent = bus.getBackgroundAgent("bg-err");
    assert.equal(agent!.status, "error");
    assert.equal(agent!.result, "timeout");
  });

  it("AgentMessageBus — lists all background agents", async () => {
    const { AgentMessageBus } = await import("../services/agent-messaging.js");
    const bus = new AgentMessageBus();

    bus.registerBackgroundAgent("a1", "reviewer");
    bus.registerBackgroundAgent("a2", "tester");
    const agents = bus.getBackgroundAgents();
    assert.equal(agents.length, 2);
  });

  // ── SessionSearchTool ──

  it("SessionSearchTool — returns no results for empty DB", async () => {
    const { SessionSearchTool } = await import("./SessionSearchTool/index.js");
    const tmp = makeTmpDir();
    const result = await SessionSearchTool.call({ query: "authentication" }, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("No matching sessions"));
  });

  it("SkillTool — path traversal blocked via ..", async () => {
    const tmp = makeTmpDir();
    const result = await SkillTool.call({ skill: "test", path: "../../../etc/passwd" }, ctx(tmp));
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("Path traversal") || result.output.includes("not found"));
  });

  it("SkillTool — absolute path traversal blocked", async () => {
    const tmp = makeTmpDir();
    const result = await SkillTool.call({ skill: "test", path: "/etc/passwd" }, ctx(tmp));
    assert.equal(result.isError, true);
  });

  // ── ScheduleWakeup lifecycle ──

  it("ScheduleWakeupTool — cancelWakeup clears pending", async () => {
    const { ScheduleWakeupTool, consumeWakeup, cancelWakeup, hasPendingWakeup } = await import(
      "./ScheduleWakeupTool/index.js"
    );
    const tmp = makeTmpDir();
    await ScheduleWakeupTool.call({ delaySeconds: 120, reason: "test", prompt: "p" }, ctx(tmp));
    assert.equal(hasPendingWakeup(), true);
    cancelWakeup();
    assert.equal(hasPendingWakeup(), false);
    assert.equal(consumeWakeup(), null);
  });

  it("suggestDelay — mid-range stays in cache window", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    assert.equal(suggestDelay(200), 200);
    assert.ok(suggestDelay(200) <= 270);
  });

  it("suggestDelay — 500s commits to the wait", async () => {
    const { suggestDelay } = await import("./ScheduleWakeupTool/index.js");
    const d = suggestDelay(500);
    assert.equal(d, 500);
  });

  // ── Background agent eviction ──

  it("AgentMessageBus — evicts old completed agents on register", async () => {
    const { AgentMessageBus } = await import("../services/agent-messaging.js");
    const bus = new AgentMessageBus();
    bus.registerBackgroundAgent("old-1", "reviewer");
    bus.completeBackgroundAgent("old-1", "done");
    // Fake the completedAt to 31 minutes ago
    const agent = bus.getBackgroundAgent("old-1");
    if (agent) agent.completedAt = Date.now() - 31 * 60 * 1000;
    // Registering a new agent should trigger eviction
    bus.registerBackgroundAgent("new-1", "tester");
    assert.equal(bus.getBackgroundAgent("old-1"), undefined);
    assert.ok(bus.getBackgroundAgent("new-1"));
  });
});
