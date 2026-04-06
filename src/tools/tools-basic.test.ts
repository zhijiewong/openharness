/**
 * Basic happy-path tests for all tools.
 * Uses node:test + node:assert/strict.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { makeTmpDir, writeFile, mockFetch, createMockTool } from "../test-helpers.js";
import type { ToolContext } from "../Tool.js";

// Tool imports
import { BashTool } from "./BashTool/index.js";
import { FileReadTool } from "./FileReadTool/index.js";
import { FileWriteTool } from "./FileWriteTool/index.js";
import { GlobTool } from "./GlobTool/index.js";
import { GrepTool } from "./GrepTool/index.js";
import { LSTool } from "./LSTool/index.js";
import { WebSearchTool } from "./WebSearchTool/index.js";
import { TaskCreateTool } from "./TaskCreateTool/index.js";
import { TaskUpdateTool } from "./TaskUpdateTool/index.js";
import { TaskListTool } from "./TaskListTool/index.js";
import { AskUserTool } from "./AskUserTool/index.js";
import { SkillTool } from "./SkillTool/index.js";
import { AgentTool } from "./AgentTool/index.js";
import { EnterPlanModeTool } from "./EnterPlanModeTool/index.js";
import { ExitPlanModeTool } from "./ExitPlanModeTool/index.js";
import { NotebookEditTool } from "./NotebookEditTool/index.js";
import { ImageReadTool } from "./ImageReadTool/index.js";
import { DiagnosticsTool } from "./DiagnosticsTool/index.js";
import { ParallelAgentTool } from "./ParallelAgentTool/index.js";
import { ToolSearchTool } from "./ToolSearchTool/index.js";

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
    const result = await FileWriteTool.call(
      { file_path: filePath, content: "test content" },
      ctx(tmp),
    );
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
    const result = await TaskCreateTool.call(
      { subject: "test task", description: "a test description" },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Task #1"));
  });

  it("TaskUpdateTool — updates an existing task", async () => {
    const tmp = makeTmpDir();
    // Create a task first
    await TaskCreateTool.call(
      { subject: "task to update", description: "original desc" },
      ctx(tmp),
    );
    const result = await TaskUpdateTool.call(
      { taskId: 1, status: "done" },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("done"));
  });

  it("TaskListTool — lists tasks", async () => {
    const tmp = makeTmpDir();
    await TaskCreateTool.call(
      { subject: "listed task", description: "desc" },
      ctx(tmp),
    );
    const result = await TaskListTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("listed task"));
  });

  it("AskUserTool — headless fallback", async () => {
    const tmp = makeTmpDir();
    const result = await AskUserTool.call(
      { question: "What color?" },
      ctx(tmp),
    );
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
    const result = await AgentTool.call(
      { prompt: "do something" },
      ctx(tmp),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("unavailable"));
  });

  it("EnterPlanModeTool — creates plan mode", async () => {
    const tmp = makeTmpDir();
    const result = await EnterPlanModeTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Plan mode entered"));
  });

  it("ExitPlanModeTool — exits plan mode", async () => {
    const tmp = makeTmpDir();
    const result = await ExitPlanModeTool.call({}, ctx(tmp));
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("Plan mode exited"));
  });

  it("NotebookEditTool — edits a notebook cell", async () => {
    const tmp = makeTmpDir();
    const notebook = {
      cells: [
        { cell_type: "code", source: ["print('old')"], metadata: {}, outputs: [] },
      ],
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
    const result = await DiagnosticsTool.call(
      { file_path: "/nonexistent/file.txt", action: "diagnostics" },
      ctx(tmp),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("No language server"));
  });

  it("ParallelAgentTool — errors without provider in context", async () => {
    const tmp = makeTmpDir();
    const result = await ParallelAgentTool.call(
      { tasks: [{ id: "a", prompt: "test" }] },
      ctx(tmp),
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("unavailable"));
  });

  it("ToolSearchTool — finds a mock tool by name", async () => {
    const tmp = makeTmpDir();
    const mock = createMockTool("MockAlpha");
    const result = await ToolSearchTool.call(
      { query: "Mock", maxResults: 5 },
      ctx(tmp, { tools: [mock] }),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("MockAlpha"));
  });
});
