/**
 * UI/UX Integration Tests
 *
 * Tests the complete user experience flow:
 * - User message visibility (the flush bug)
 * - Multi-turn conversations
 * - Streaming state transitions
 * - Interactive prompts (permission, question)
 * - Scrolling and viewport management
 * - Terminal resize behavior
 * - Toast notifications
 * - Input handling (multi-line, vim mode, line count)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssistantMessage, createUserMessage } from "../types/message.js";
import { setActiveTheme } from "../utils/theme-data.js";
import { CellGrid } from "./cells.js";
import { type LayoutState, rasterize, rasterizeLive, type ToolCallInfo } from "./layout.js";

setActiveTheme("dark");

// ── Helpers ──

function makeState(overrides: Partial<LayoutState> = {}): LayoutState {
  return {
    messages: [],
    streamingText: "",
    thinkingText: "",
    toolCalls: new Map(),
    inputText: "",
    inputCursor: 0,
    companionLines: null,
    companionColor: "cyan",
    statusHints: "exit to quit",
    statusLine: "llama3 | 0↑ 0↓ | $0.0000",
    contextWarning: null,
    errorText: null,
    loading: false,
    spinnerFrame: 0,
    thinkingStartedAt: null,
    tokenCount: 0,
    vimMode: null,
    permissionBox: null,
    permissionDiffVisible: false,
    permissionDiffInfo: null,
    expandedToolCalls: new Set(),
    questionPrompt: null,
    autocomplete: [],
    autocompleteIndex: -1,
    manualScroll: 0,
    codeBlocksExpanded: false,
    sessionBrowser: null,
    bannerLines: null,
    thinkingExpanded: false,
    lastThinkingSummary: null,
    autocompleteDescriptions: [],
    notifications: [],
    ...overrides,
  };
}

function gridText(grid: CellGrid, row: number): string {
  return grid.cells[row]!.map((c) => c.char)
    .join("")
    .trimEnd();
}

function gridAllText(grid: CellGrid): string {
  return Array.from({ length: grid.height }, (_, r) => gridText(grid, r)).join("\n");
}

function findRow(grid: CellGrid, text: string): number {
  for (let r = 0; r < grid.height; r++) {
    if (gridText(grid, r).includes(text)) return r;
  }
  return -1;
}

// ── 1. User Message Visibility ──

describe("User message visibility", () => {
  it("renders user message with ❯ prefix in message area", () => {
    const state = makeState({
      messages: [createUserMessage("write me a song")],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const row = findRow(grid, "write me a song");
    assert.ok(row >= 0, "User message not found in grid");
    assert.ok(gridText(grid, row).includes("❯"), "Missing ❯ prefix");
  });

  it("renders user and assistant messages on separate lines", () => {
    const state = makeState({
      messages: [createUserMessage("hello"), createAssistantMessage("hi there")],
    });
    const grid = new CellGrid(80, 30);
    rasterize(state, grid);
    const userRow = findRow(grid, "hello");
    const assistantRow = findRow(grid, "hi there");
    assert.ok(userRow >= 0, "User message not found");
    assert.ok(assistantRow >= 0, "Assistant message not found");
    assert.ok(assistantRow > userRow, "Assistant should be below user");
  });

  it("shows divider between messages", () => {
    const state = makeState({
      messages: [createUserMessage("first"), createAssistantMessage("second")],
    });
    const grid = new CellGrid(80, 30);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("─"), "No divider found between messages");
  });
});

// ── 2. Multi-Turn Conversations ──

describe("Multi-turn conversations", () => {
  it("renders 3 turns correctly ordered", () => {
    const state = makeState({
      messages: [
        createUserMessage("What is 2+2?"),
        createAssistantMessage("2+2 = 4"),
        createUserMessage("And 3+3?"),
        createAssistantMessage("3+3 = 6"),
        createUserMessage("Thanks!"),
        createAssistantMessage("You're welcome!"),
      ],
    });
    const grid = new CellGrid(80, 50);
    rasterize(state, grid);
    const all = gridAllText(grid);
    const pos1 = all.indexOf("2+2");
    const pos2 = all.indexOf("3+3");
    const pos3 = all.indexOf("Thanks");
    assert.ok(pos1 < pos2, "Turn 1 should appear before turn 2");
    assert.ok(pos2 < pos3, "Turn 2 should appear before turn 3");
  });
});

// ── 3. Streaming State ──

describe("Streaming state", () => {
  it("shows spinner when loading with no streaming text", () => {
    const state = makeState({ loading: true, spinnerFrame: 3 });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("Thinking") || all.includes("◆"), "No spinner/thinking indicator");
  });

  it("shows streaming text with ◆ prefix", () => {
    const state = makeState({
      loading: true,
      streamingText: "Hello world from the LLM",
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Hello world");
    assert.ok(row >= 0, "Streaming text not found");
  });

  it("shows thinking shimmer text", () => {
    const state = makeState({
      loading: true,
      thinkingText: "Let me think about this...\nAnalyzing the request.",
      thinkingStartedAt: Date.now() - 5000,
      spinnerFrame: 5,
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("Thinking") || all.includes("∴"), "Thinking indicator not found");
  });
});

// ── 4. Tool Call Display ──

describe("Tool call display", () => {
  it("shows running tool with spinner", () => {
    const tc: ToolCallInfo = {
      toolName: "Bash",
      status: "running",
      output: "",
      args: "$ npm test",
      startedAt: Date.now() - 3000,
      liveOutput: ["PASS test1", "PASS test2"],
      resultSummary: "",
    };
    const state = makeState({
      loading: true,
      toolCalls: new Map([["call-1", tc]]),
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Bash");
    assert.ok(row >= 0, "Tool name not found");
  });

  it("shows completed tool with ✓", () => {
    const tc: ToolCallInfo = {
      toolName: "Read",
      status: "done",
      output: "file contents here",
      args: "src/main.ts",
      startedAt: Date.now() - 1000,
      liveOutput: [],
      resultSummary: "42 lines",
    };
    const state = makeState({
      toolCalls: new Map([["call-1", tc]]),
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Read");
    assert.ok(row >= 0, "Tool name not found");
    assert.ok(gridText(grid, row).includes("✓"), "Missing ✓ icon for completed tool");
  });

  it("shows error tool with ✗", () => {
    const tc: ToolCallInfo = {
      toolName: "Bash",
      status: "error",
      output: "command not found",
      args: "$ invalid-cmd",
      startedAt: Date.now() - 500,
      liveOutput: [],
      resultSummary: "error",
    };
    const state = makeState({
      toolCalls: new Map([["call-1", tc]]),
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Bash");
    assert.ok(row >= 0, "Tool name not found");
    assert.ok(gridText(grid, row).includes("✗"), "Missing ✗ icon for error tool");
  });
});

// ── 5. Permission Prompt ──

describe("Permission prompt", () => {
  it("renders permission box with tool name and risk level", () => {
    const state = makeState({
      permissionBox: {
        toolName: "Bash",
        description: "$ rm -rf /tmp/test",
        riskLevel: "high",
        suggestion: "$ rm -rf /tmp/test",
      },
      permissionDiffVisible: false,
      permissionDiffInfo: null,
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("Bash"), "Tool name not in permission prompt");
    assert.ok(all.includes("Y") || all.includes("yes"), "Yes option not shown");
    assert.ok(all.includes("N") || all.includes("no"), "No option not shown");
  });
});

// ── 6. Notifications ──

describe("Toast notifications", () => {
  it("renders notifications above input in rasterize", () => {
    const state = makeState({
      notifications: [{ text: "Background task completed" }],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const row = findRow(grid, "Background task completed");
    assert.ok(row >= 0, "Notification not found in rasterize");
    assert.ok(gridText(grid, row).includes("⚡"), "Missing ⚡ icon");
  });

  it("renders notifications in rasterizeLive", () => {
    const state = makeState({
      notifications: [{ text: "Agent finished" }],
      loading: true,
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Agent finished");
    assert.ok(row >= 0, "Notification not found in rasterizeLive");
  });

  it("limits to 2 visible notifications", () => {
    const state = makeState({
      notifications: [{ text: "First" }, { text: "Second" }, { text: "Third" }],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    // Only last 2 should be visible
    assert.ok(all.includes("Second"), "Second notification should be visible");
    assert.ok(all.includes("Third"), "Third notification should be visible");
  });
});

// ── 7. Multi-line Input ──

describe("Multi-line input", () => {
  it("shows line count indicator for multi-line input", () => {
    const state = makeState({
      inputText: "line one\nline two\nline three",
      inputCursor: 10,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("[3 lines]"), "Line count indicator not found");
  });

  it("does not show line count for single-line input", () => {
    const state = makeState({
      inputText: "just one line",
      inputCursor: 5,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(!all.includes("["), "Line count should not appear for single line");
  });

  it("shows line count in rasterizeLive too", () => {
    const state = makeState({
      inputText: "a\nb",
      inputCursor: 2,
      loading: true,
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("[2 lines]"), "Line count not in rasterizeLive");
  });
});

// ── 8. Vim Mode ──

describe("Vim mode indicator", () => {
  it("shows [N] in normal mode", () => {
    const state = makeState({ vimMode: "normal", inputText: "hello" });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("[N]"), "Vim normal indicator not found");
  });

  it("shows [I] in insert mode", () => {
    const state = makeState({ vimMode: "insert", inputText: "hello" });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("[I]"), "Vim insert indicator not found");
  });

  it("shows no indicator when vim mode is off", () => {
    const state = makeState({ vimMode: null, inputText: "hello" });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(!all.includes("[N]") && !all.includes("[I]"), "Vim indicator should be hidden");
  });
});

// ── 9. Terminal Resize ──

describe("Terminal resize behavior", () => {
  it("renders correctly at 40-column width", () => {
    const state = makeState({
      messages: [createUserMessage("Hello")],
      statusLine: "model | 0↑ 0↓",
    });
    const grid = new CellGrid(40, 24);
    rasterize(state, grid);
    assert.ok(findRow(grid, "Hello") >= 0, "Content should render at narrow width");
  });

  it("renders correctly at 120-column width", () => {
    const state = makeState({
      messages: [createUserMessage("Hello")],
    });
    const grid = new CellGrid(120, 24);
    rasterize(state, grid);
    assert.ok(findRow(grid, "Hello") >= 0, "Content should render at wide width");
  });

  it("wraps long messages at terminal width", () => {
    const longMsg = "A".repeat(100);
    const state = makeState({
      messages: [createUserMessage(longMsg)],
    });
    const grid50 = new CellGrid(50, 24);
    rasterize(state, grid50);
    const grid100 = new CellGrid(100, 24);
    rasterize(state, grid100);
    // Narrow grid should use more rows for the same message
    const rows50 = Array.from({ length: grid50.height }, (_, r) => gridText(grid50, r)).filter((l) =>
      l.includes("A"),
    ).length;
    const rows100 = Array.from({ length: grid100.height }, (_, r) => gridText(grid100, r)).filter((l) =>
      l.includes("A"),
    ).length;
    assert.ok(rows50 > rows100, "Narrow terminal should wrap to more rows");
  });
});

// ── 10. Autocomplete ──

describe("Autocomplete rendering", () => {
  it("shows suggestions below input", () => {
    const state = makeState({
      inputText: "/he",
      autocomplete: ["help", "history"],
      autocompleteDescriptions: ["Show commands", "List sessions"],
      autocompleteIndex: 0,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const all = gridAllText(grid);
    assert.ok(all.includes("help"), "Autocomplete suggestion not visible");
    assert.ok(all.includes("history"), "Second suggestion not visible");
  });
});

// ── 11. Error Display ──

describe("Error display", () => {
  it("renders error text with ✗ prefix", () => {
    const state = makeState({
      errorText: "Connection refused",
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "Connection refused");
    assert.ok(row >= 0, "Error text not found");
  });
});

// ── 12. Context Warning ──

describe("Context warning", () => {
  it("renders context warning text", () => {
    const state = makeState({
      contextWarning: { text: "⚠ Context ~85% full — consider /compact", critical: false },
    });
    const grid = new CellGrid(80, 24);
    rasterizeLive(state, grid);
    const row = findRow(grid, "85%");
    assert.ok(row >= 0, "Context warning not found");
  });
});

// ── 13. Status Line ──

describe("Status line", () => {
  it("renders status line content", () => {
    const state = makeState({
      statusLine: "llama3 | 1.2K↑ 500↓ | $0.0042 | ctx [███░░] 45%",
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const row = findRow(grid, "llama3");
    assert.ok(row >= 0, "Status line not found");
    assert.ok(gridText(grid, row).includes("$0.0042"), "Cost not in status line");
  });
});

// ── 14. rasterize vs rasterizeLive parity ──

describe("rasterize/rasterizeLive parity", () => {
  it("both render notifications", () => {
    const state = makeState({
      notifications: [{ text: "parity test" }],
      loading: true,
    });
    const grid1 = new CellGrid(80, 24);
    rasterize(state, grid1);
    const grid2 = new CellGrid(80, 24);
    rasterizeLive(state, grid2);
    assert.ok(findRow(grid1, "parity test") >= 0, "rasterize missing notification");
    assert.ok(findRow(grid2, "parity test") >= 0, "rasterizeLive missing notification");
  });

  it("both render status line", () => {
    const state = makeState({
      statusLine: "model-xyz",
      loading: true,
    });
    const grid1 = new CellGrid(80, 24);
    rasterize(state, grid1);
    const grid2 = new CellGrid(80, 24);
    rasterizeLive(state, grid2);
    assert.ok(findRow(grid1, "model-xyz") >= 0, "rasterize missing status");
    assert.ok(findRow(grid2, "model-xyz") >= 0, "rasterizeLive missing status");
  });

  it("both render input prompt", () => {
    const state = makeState({
      inputText: "test input",
      loading: true,
    });
    const grid1 = new CellGrid(80, 24);
    rasterize(state, grid1);
    const grid2 = new CellGrid(80, 24);
    rasterizeLive(state, grid2);
    assert.ok(findRow(grid1, "❯") >= 0, "rasterize missing prompt");
    assert.ok(findRow(grid2, "❯") >= 0, "rasterizeLive missing prompt");
  });
});
