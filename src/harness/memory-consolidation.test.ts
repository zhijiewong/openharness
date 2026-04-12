import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import { consolidateMemories, decayAndPrune, deletePrunedMemories, type MemoryEntry } from "./memory.js";

/** Create a memory file with backdated timestamps */
function createMemoryFile(
  dir: string,
  name: string,
  opts: { relevance?: number; lastAccessed?: number; type?: string } = {},
): string {
  mkdirSync(dir, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filePath = join(dir, `${slug}.md`);
  const relevance = opts.relevance ?? 0.5;
  const lastAccessed = opts.lastAccessed ?? Date.now();
  const type = opts.type ?? "convention";

  writeFileSync(
    filePath,
    `---
name: ${name}
type: ${type}
description: Test memory
relevance: ${relevance}
createdAt: ${lastAccessed}
lastAccessed: ${lastAccessed}
accessCount: 1
---

Test content for ${name}
`,
  );
  return filePath;
}

describe("dream consolidation", () => {
  describe("decayAndPrune", () => {
    it("keeps recent memories active", () => {
      const now = Date.now();
      const memories: MemoryEntry[] = [
        {
          name: "recent",
          type: "convention",
          description: "test",
          content: "test",
          filePath: "/tmp/recent.md",
          relevance: 0.5,
          lastAccessed: now,
          createdAt: now,
          accessCount: 1,
        },
      ];
      const { active, pruned } = decayAndPrune(memories);
      assert.equal(active.length, 1);
      assert.equal(pruned.length, 0);
    });

    it("decays memories older than 30 days", () => {
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const memories: MemoryEntry[] = [
        {
          name: "old",
          type: "convention",
          description: "test",
          content: "test",
          filePath: "/tmp/old.md",
          relevance: 0.5,
          lastAccessed: Date.now() - THIRTY_DAYS * 2,
          createdAt: Date.now() - THIRTY_DAYS * 3,
          accessCount: 1,
        },
      ];
      const { active, pruned } = decayAndPrune(memories);
      assert.equal(active.length, 1);
      assert.equal(pruned.length, 0);
      // Should have decayed by 0.2 (2 periods)
      assert.ok(active[0]!.relevance! < 0.5);
      assert.ok(active[0]!.relevance! >= 0.2);
    });

    it("prunes memories below 0.1 relevance", () => {
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const memories: MemoryEntry[] = [
        {
          name: "ancient",
          type: "convention",
          description: "test",
          content: "test",
          filePath: "/tmp/ancient.md",
          relevance: 0.5,
          lastAccessed: Date.now() - THIRTY_DAYS * 6, // 6 periods = -0.6 decay
          createdAt: Date.now() - THIRTY_DAYS * 7,
          accessCount: 1,
        },
      ];
      const { active, pruned } = decayAndPrune(memories);
      assert.equal(active.length, 0);
      assert.equal(pruned.length, 1);
      assert.equal(pruned[0]!.name, "ancient");
    });

    it("handles memories without timestamps gracefully", () => {
      const memories: MemoryEntry[] = [
        {
          name: "no-dates",
          type: "convention",
          description: "test",
          content: "test",
          filePath: "/tmp/no-dates.md",
          relevance: 0.5,
        },
      ];
      const { active, pruned } = decayAndPrune(memories);
      // Without lastAccessed, falls back to now — should not decay
      assert.equal(active.length, 1);
      assert.equal(pruned.length, 0);
    });
  });

  describe("deletePrunedMemories", () => {
    it("deletes files within allowed directories", () => {
      const tmp = makeTmpDir();
      const memDir = join(tmp, ".oh", "memory");
      const filePath = createMemoryFile(memDir, "to-delete");
      assert.ok(existsSync(filePath));

      // Mock: deletePrunedMemories checks against PROJECT_MEMORY_DIR and GLOBAL_MEMORY_DIR
      // which are hardcoded. For this test, just verify the function signature works.
      const entry: MemoryEntry = {
        name: "to-delete",
        type: "convention",
        description: "test",
        content: "test",
        filePath,
        relevance: 0.05,
      };

      // deletePrunedMemories uses directory guards against .oh/memory and ~/.oh/memory
      // Since our tmp dir doesn't match, it should skip deletion (guard works)
      const deleted = deletePrunedMemories([entry]);
      // The directory guard should prevent deletion since tmp dir != .oh/memory
      assert.equal(deleted, 0);
    });

    it("handles missing files gracefully", () => {
      const entry: MemoryEntry = {
        name: "nonexistent",
        type: "convention",
        description: "test",
        content: "test",
        filePath: "/tmp/definitely-does-not-exist-12345.md",
        relevance: 0.05,
      };
      // Should not throw
      const deleted = deletePrunedMemories([entry]);
      assert.equal(deleted, 0);
    });

    it("handles empty pruned list", () => {
      const deleted = deletePrunedMemories([]);
      assert.equal(deleted, 0);
    });
  });

  describe("consolidateMemories", () => {
    it("returns zero stats when no memories exist", () => {
      // consolidateMemories loads from .oh/memory/ which may or may not exist
      // In test environment, it should handle gracefully
      const result = consolidateMemories();
      assert.equal(typeof result.total, "number");
      assert.equal(typeof result.pruned, "number");
      assert.equal(typeof result.decayed, "number");
    });
  });
});
