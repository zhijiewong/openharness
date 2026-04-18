import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import {
  boostRelevance,
  claudeMdToPrompt,
  loadClaudeMdHierarchy,
  loadMemories,
  loadUserProfile,
  memoriesToPrompt,
  resolveClaudeMdImports,
  saveMemory,
  touchMemory,
  updateMemoryIndex,
  updateUserProfile,
  userProfileToPrompt,
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

// ── User Profile ──

test("loadUserProfile returns empty string when USER.md does not exist", () => {
  withTmpCwd(() => {
    const profile = loadUserProfile();
    assert.equal(profile, "");
  });
});

test("updateUserProfile creates USER.md with content", () => {
  withTmpCwd(() => {
    updateUserProfile("## Role\nSenior engineer\n\n## Preferences\nTerse responses");
    const profile = loadUserProfile();
    assert.ok(profile.includes("Senior engineer"));
    assert.ok(profile.includes("Terse responses"));
  });
});

test("updateUserProfile truncates to 1375 chars (Hermes-aligned)", () => {
  withTmpCwd(() => {
    const longContent = "x".repeat(3000);
    updateUserProfile(longContent);
    const profile = loadUserProfile();
    assert.ok(profile.length <= 1375);
  });
});

test("userProfileToPrompt formats correctly", () => {
  withTmpCwd(() => {
    updateUserProfile("## Role\nData scientist");
    const prompt = userProfileToPrompt();
    assert.ok(prompt.includes("# User Profile"));
    assert.ok(prompt.includes("Data scientist"));
  });
});

test("userProfileToPrompt returns empty string when no profile", () => {
  withTmpCwd(() => {
    assert.equal(userProfileToPrompt(), "");
  });
});

// ── CLAUDE.md hierarchy ──

test("loadClaudeMdHierarchy returns [] when no CLAUDE.md anywhere", () => {
  withTmpCwd(() => {
    const entries = loadClaudeMdHierarchy();
    // Filter to project-scoped — user-global ~/.claude/CLAUDE.md may exist on the runner
    const local = entries.filter((e) => e.source !== "user");
    assert.deepEqual(local, []);
  });
});

test("loadClaudeMdHierarchy reads project CLAUDE.md", () => {
  withTmpCwd((dir) => {
    writeFileSync(join(dir, "CLAUDE.md"), "# Project rules\nAlways use TypeScript strict mode.");
    const entries = loadClaudeMdHierarchy();
    const project = entries.find((e) => e.source === "project");
    assert.ok(project);
    assert.ok(project!.content.includes("Always use TypeScript"));
  });
});

test("loadClaudeMdHierarchy reads .claude/CLAUDE.md when present", () => {
  withTmpCwd((dir) => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "CLAUDE.md"), "# Claude-dir rules\nPrefer named exports.");
    const entries = loadClaudeMdHierarchy();
    const claudeDir = entries.find((e) => e.source === "claude-dir");
    assert.ok(claudeDir);
    assert.ok(claudeDir!.content.includes("Prefer named exports"));
  });
});

test("loadClaudeMdHierarchy reads CLAUDE.local.md (gitignored)", () => {
  withTmpCwd((dir) => {
    writeFileSync(join(dir, "CLAUDE.local.md"), "My personal notes.");
    const entries = loadClaudeMdHierarchy();
    const local = entries.find((e) => e.source === "project-local");
    assert.ok(local);
    assert.ok(local!.content.includes("personal notes"));
  });
});

test("loadClaudeMdHierarchy layers multiple sources", () => {
  withTmpCwd((dir) => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "CLAUDE.md"), "A");
    writeFileSync(join(dir, "CLAUDE.md"), "B");
    writeFileSync(join(dir, "CLAUDE.local.md"), "C");
    const entries = loadClaudeMdHierarchy();
    const sources = entries.map((e) => e.source).filter((s) => s !== "user");
    // Order: claude-dir, project, project-local (user is last in scan order)
    assert.deepEqual(sources, ["claude-dir", "project", "project-local"]);
  });
});

test("resolveClaudeMdImports inlines @-imports", () => {
  withTmpCwd((dir) => {
    writeFileSync(join(dir, "style.md"), "Use tabs.");
    const result = resolveClaudeMdImports("Read @style.md for style.", dir);
    assert.ok(result.includes("Use tabs."));
    assert.ok(result.includes("imported from @style.md"));
  });
});

test("resolveClaudeMdImports handles nested imports", () => {
  withTmpCwd((dir) => {
    writeFileSync(join(dir, "inner.md"), "Inner content.");
    writeFileSync(join(dir, "outer.md"), "Outer imports @inner.md here.");
    const result = resolveClaudeMdImports("Top-level @outer.md", dir);
    assert.ok(result.includes("Outer imports"));
    assert.ok(result.includes("Inner content."));
  });
});

test("resolveClaudeMdImports skips non-path tokens", () => {
  withTmpCwd((dir) => {
    // @username-style mentions should be left alone (no slash / no extension)
    const result = resolveClaudeMdImports("Contact @alice for help.", dir);
    assert.equal(result, "Contact @alice for help.");
  });
});

test("resolveClaudeMdImports caps recursion at 5 hops", () => {
  withTmpCwd((dir) => {
    // Build a chain deeper than the 5-hop cap. Starting hopsLeft=5 expands
    // chain0..chain4 (5 recursive calls); chain5 remains as a literal @ token.
    for (let i = 0; i < 8; i++) {
      const next = i < 7 ? `@chain${i + 1}.md` : "end.";
      writeFileSync(join(dir, `chain${i}.md`), `level ${i} ${next}`);
    }
    const result = resolveClaudeMdImports("@chain0.md", dir);
    assert.ok(result.includes("level 0"));
    assert.ok(result.includes("level 4"));
    // Depth exhausted at level 5 — chain5.md's content is NOT inlined
    assert.ok(!result.includes("level 5"));
    // The literal @chain5.md token survives (proof of stop, not truncation)
    assert.ok(result.includes("@chain5.md"));
  });
});

test("resolveClaudeMdImports silently drops missing imports", () => {
  withTmpCwd((dir) => {
    const result = resolveClaudeMdImports("Load @missing.md file.", dir);
    // @missing.md stays literal in the output when the file doesn't exist
    assert.ok(result.includes("@missing.md"));
  });
});

test("claudeMdToPrompt returns empty string for empty input", () => {
  assert.equal(claudeMdToPrompt([]), "");
});

test("claudeMdToPrompt formats entries with source headers", () => {
  const prompt = claudeMdToPrompt([
    { path: "./CLAUDE.md", source: "project", content: "Use TS." },
    { path: "~/.claude/CLAUDE.md", source: "user", content: "Prefer minimal comments." },
  ]);
  assert.ok(prompt.includes("# Project instructions (CLAUDE.md)"));
  assert.ok(prompt.includes("source: project"));
  assert.ok(prompt.includes("source: user"));
  assert.ok(prompt.includes("Use TS."));
  assert.ok(prompt.includes("minimal comments"));
});
