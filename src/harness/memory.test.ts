import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import {
  boostRelevance,
  loadMemories,
  memoriesToPrompt,
  saveMemory,
  touchMemory,
  updateMemoryIndex,
} from "./memory.js";

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
  withTmpCwd((_dir) => {
    const filePath = saveMemory("test-conv", "convention", "A test convention", "Always use semicolons");
    const content = readFileSync(filePath, "utf-8");
    assert.ok(content.includes("name: test-conv"));
    assert.ok(content.includes("type: convention"));
    assert.ok(content.includes("description: A test convention"));
    assert.ok(content.includes("Always use semicolons"));
  });
});

test("loadMemories reads saved memories from project dir", () => {
  withTmpCwd((_dir) => {
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

test("touchMemory updates lastAccessed and accessCount", () => {
  withTmpCwd(() => {
    const filePath = saveMemory("touch-test", "convention", "test", "content");
    const raw1 = readFileSync(filePath, "utf-8");
    assert.ok(raw1.includes("accessCount: 0"));

    const entry = {
      name: "touch-test",
      type: "convention" as const,
      description: "test",
      content: "content",
      filePath,
      accessCount: 0,
      lastAccessed: Date.now() - 10000,
    };
    touchMemory(entry);

    const raw2 = readFileSync(filePath, "utf-8");
    assert.ok(raw2.includes("accessCount: 1"));
    assert.ok(entry.accessCount === 1);
  });
});

test("boostRelevance increases score and caps at 1.0", () => {
  withTmpCwd(() => {
    const filePath = saveMemory("boost-test", "convention", "test", "content");
    const entry = {
      name: "boost-test",
      type: "convention" as const,
      description: "test",
      content: "content",
      filePath,
      relevance: 0.5,
    };

    boostRelevance(entry, 0.3);
    assert.equal(entry.relevance, 0.8);

    // Verify written to file
    const raw = readFileSync(filePath, "utf-8");
    assert.ok(raw.includes("relevance: 0.80"));

    // Cap at 1.0
    boostRelevance(entry, 0.5);
    assert.equal(entry.relevance, 1.0);
  });
});

test("saved memory has relevance and timestamps in frontmatter", () => {
  withTmpCwd(() => {
    const filePath = saveMemory("meta-test", "preference", "test", "content");
    const raw = readFileSync(filePath, "utf-8");
    assert.ok(raw.includes("relevance: 0.5"));
    assert.ok(raw.match(/createdAt: \d+/));
    assert.ok(raw.match(/lastAccessed: \d+/));
    assert.ok(raw.includes("accessCount: 0"));
  });
});

// ── MEMORY.md Index ──

test("saveMemory creates MEMORY.md index file", () => {
  withTmpCwd(() => {
    saveMemory("first-memory", "user", "A user memory", "User is a senior dev");
    saveMemory("second-memory", "feedback", "A feedback memory", "Prefers short responses");
    const indexPath = join(process.cwd(), ".oh", "memory", "MEMORY.md");
    assert.ok(existsSync(indexPath), "MEMORY.md should exist");

    const index = readFileSync(indexPath, "utf-8");
    assert.ok(index.includes("# Memory Index"));
    assert.ok(index.includes("first-memory"));
    assert.ok(index.includes("second-memory"));
    assert.ok(index.includes("A user memory"));
    assert.ok(index.includes("A feedback memory"));
  });
});

test("updateMemoryIndex ignores non-existent directory", () => {
  // Should not throw
  updateMemoryIndex("/nonexistent/path/to/nothing");
});

// ── New Memory Types ──

test("saveMemory accepts new type names (user, feedback, reference)", () => {
  withTmpCwd(() => {
    const p1 = saveMemory("user-role", "user", "User role info", "Senior engineer");
    assert.ok(readFileSync(p1, "utf-8").includes("type: user"));

    const p2 = saveMemory("correction", "feedback", "Style feedback", "No trailing summaries");
    assert.ok(readFileSync(p2, "utf-8").includes("type: feedback"));

    const p3 = saveMemory("linear-board", "reference", "Bug tracker", "Bugs in Linear INGEST");
    assert.ok(readFileSync(p3, "utf-8").includes("type: reference"));
  });
});
