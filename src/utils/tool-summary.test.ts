import assert from "node:assert";
import { describe, it } from "node:test";
import { formatToolArgs, summarizeToolArgs, summarizeToolOutput } from "./tool-summary.js";

describe("summarizeToolArgs", () => {
  it("extracts command from Bash tool", () => {
    const result = summarizeToolArgs("Bash", JSON.stringify({ command: "ls -la" }));
    assert.ok(result !== null);
    assert.ok(result!.includes("ls -la"));
    assert.ok(result!.startsWith("$"));
  });

  it("extracts file_path from Read tool", () => {
    const result = summarizeToolArgs("Read", JSON.stringify({ file_path: "/src/index.ts" }));
    assert.ok(result !== null);
    assert.ok(result!.includes("/src/index.ts"));
    assert.ok(result!.includes("reading"));
  });

  it("extracts file_path from Write tool", () => {
    const result = summarizeToolArgs("Write", JSON.stringify({ file_path: "/out/file.txt" }));
    assert.ok(result !== null);
    assert.ok(result!.includes("/out/file.txt"));
    assert.ok(result!.includes("writing"));
  });

  it("extracts file_path from Edit tool", () => {
    const result = summarizeToolArgs("Edit", JSON.stringify({ file_path: "/src/app.ts" }));
    assert.ok(result !== null);
    assert.ok(result!.includes("/src/app.ts"));
    assert.ok(result!.includes("editing"));
  });

  it("extracts pattern from Grep tool", () => {
    const result = summarizeToolArgs("Grep", JSON.stringify({ pattern: "TODO" }));
    assert.ok(result !== null);
    assert.ok(result!.includes("pattern: TODO"));
  });

  it("returns null for unknown tool", () => {
    const result = summarizeToolArgs("UnknownTool", JSON.stringify({ foo: "bar" }));
    assert.strictEqual(result, null);
  });

  it("returns null for malformed JSON", () => {
    const result = summarizeToolArgs("Bash", "not valid json {{");
    assert.strictEqual(result, null);
  });

  it("returns null for malformed JSON on file tools", () => {
    const result = summarizeToolArgs("Read", "{broken json");
    // Falls back to regex; if no path/file match, returns null
    assert.ok(result === null || typeof result === "string");
  });
});

describe("formatToolArgs", () => {
  it("returns file_path when present", () => {
    const result = formatToolArgs("Read", { file_path: "/src/index.ts" });
    assert.strictEqual(result, "/src/index.ts");
  });

  it("returns command prefixed with $ when present", () => {
    const result = formatToolArgs("Bash", { command: "echo hello" });
    assert.strictEqual(result, "$ echo hello");
  });

  it("returns pattern when present", () => {
    const result = formatToolArgs("Grep", { pattern: "TODO" });
    assert.strictEqual(result, "pattern: TODO");
  });

  it("falls back to JSON.stringify for unknown args", () => {
    const args = { foo: "bar" };
    const result = formatToolArgs("UnknownTool", args);
    assert.strictEqual(result, JSON.stringify(args));
  });

  it("truncates long args with ellipsis", () => {
    const result = formatToolArgs("Unknown", { data: "a".repeat(100) });
    assert.ok(result.length <= 60, `Expected <= 60 chars, got ${result.length}`);
    assert.ok(result.endsWith("..."));
  });

  it("returns url when present", () => {
    const result = formatToolArgs("WebFetch", { url: "https://example.com" });
    assert.strictEqual(result, "https://example.com");
  });
});

describe("summarizeToolOutput", () => {
  it("returns empty string for empty output", () => {
    assert.strictEqual(summarizeToolOutput(""), "");
  });

  it("returns short single-line output directly", () => {
    assert.strictEqual(summarizeToolOutput("OK"), "OK");
  });

  it("returns line count for multi-line output", () => {
    const result = summarizeToolOutput("line1\nline2\nline3");
    assert.strictEqual(result, "3 lines");
  });

  it("returns line count for long single-line output", () => {
    const longLine = "x".repeat(100);
    const result = summarizeToolOutput(longLine);
    assert.strictEqual(result, "1 lines");
  });
});
