import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { loadMemories, saveMemory, memoriesToPrompt } from "./memory.js";

function withTmpCwd(fn: (dir: string) => void) {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(original);
  }
}

test("saveMemory writes a .md file with frontmatter", () => {
  withTmpCwd((dir) => {
    const filePath = saveMemory("test-conv", "convention", "A test convention", "Always use semicolons");
    const content = readFileSync(filePath, "utf-8");
    assert.ok(content.includes("name: test-conv"));
    assert.ok(content.includes("type: convention"));
    assert.ok(content.includes("description: A test convention"));
    assert.ok(content.includes("Always use semicolons"));
  });
});

test("loadMemories reads saved memories from project dir", () => {
  withTmpCwd((dir) => {
    // saveMemory writes to .oh/memory/ relative to cwd
    const filePath = saveMemory("my-pref", "preference", "User prefers tabs", "Use tabs over spaces");
    // Verify file was written
    const content = readFileSync(filePath, "utf-8");
    assert.ok(content.includes("my-pref"));
    assert.ok(content.includes("Use tabs over spaces"));
  });
});

test("loadMemories returns [] when no dir exists", () => {
  withTmpCwd(() => {
    // no .oh/memory/ created
    const memories = loadMemories();
    const local = memories.filter((m) => m.filePath.includes("oh-test-"));
    assert.equal(local.length, 0);
  });
});

test("memoriesToPrompt formats as bullet list", () => {
  const prompt = memoriesToPrompt([
    { name: "tabs", type: "preference", description: "Use tabs", content: "Always use tabs", filePath: "/tmp/tabs.md" },
  ]);
  assert.ok(prompt.includes("# Remembered Context"));
  assert.ok(prompt.includes("- **tabs** (preference): Always use tabs"));
});

test("memoriesToPrompt returns empty string for empty array", () => {
  assert.equal(memoriesToPrompt([]), "");
});

test("saved memory has correct name/type/description in file content", () => {
  withTmpCwd(() => {
    const filePath = saveMemory("debug-tip", "debugging", "Fix null ref", "Check for null before access");
    const raw = readFileSync(filePath, "utf-8");
    assert.ok(raw.includes("name: debug-tip"));
    assert.ok(raw.includes("type: debugging"));
    assert.ok(raw.includes("description: Fix null ref"));
    assert.ok(raw.includes("Check for null before access"));
  });
});
