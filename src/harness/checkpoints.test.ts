/**
 * Tests for checkpoint system — snapshot and rewind.
 */

import assert from "node:assert/strict";
import { writeFileSync as fsWriteFile, readFileSync } from "node:fs";
import test from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import {
  checkpointCount,
  createCheckpoint,
  getAffectedFiles,
  initCheckpoints,
  listCheckpoints,
  rewindLastCheckpoint,
} from "./checkpoints.js";

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

test("initCheckpoints sets up session", () => {
  withTmpCwd(() => {
    initCheckpoints("test-session-1");
    assert.equal(checkpointCount(), 0);
    assert.deepEqual(listCheckpoints(), []);
  });
});

test("createCheckpoint saves files and can be rewound", () => {
  withTmpCwd((dir) => {
    initCheckpoints("test-session-2");

    // Create a file to checkpoint
    const filePath = writeFile(dir, "hello.txt", "original content");

    // Create checkpoint
    const cp = createCheckpoint(1, [filePath], "FileEdit hello.txt");
    assert.ok(cp);
    assert.equal(cp!.turn, 1);
    assert.equal(cp!.files.length, 1);
    assert.equal(cp!.description, "FileEdit hello.txt");
    assert.equal(checkpointCount(), 1);

    // Modify the file
    fsWriteFile(filePath, "modified content");
    assert.equal(readFileSync(filePath, "utf-8"), "modified content");

    // Rewind
    const restored = rewindLastCheckpoint();
    assert.ok(restored);
    assert.equal(restored!.turn, 1);
    assert.equal(readFileSync(filePath, "utf-8"), "original content");
    assert.equal(checkpointCount(), 0);
  });
});

test("createCheckpoint returns null for empty file list", () => {
  withTmpCwd(() => {
    initCheckpoints("test-session-3");
    const cp = createCheckpoint(1, [], "empty");
    assert.equal(cp, null);
  });
});

test("createCheckpoint skips non-existent files", () => {
  withTmpCwd(() => {
    initCheckpoints("test-session-4");
    const cp = createCheckpoint(1, ["/nonexistent/file.txt"], "missing");
    assert.equal(cp, null);
  });
});

test("rewindLastCheckpoint returns null when no checkpoints", () => {
  withTmpCwd(() => {
    initCheckpoints("test-session-5");
    assert.equal(rewindLastCheckpoint(), null);
  });
});

test("listCheckpoints returns all checkpoints", () => {
  withTmpCwd((dir) => {
    initCheckpoints("test-session-6");
    const f1 = writeFile(dir, "a.txt", "aaa");
    const f2 = writeFile(dir, "b.txt", "bbb");

    createCheckpoint(1, [f1], "edit a");
    createCheckpoint(2, [f2], "edit b");

    const cps = listCheckpoints();
    assert.equal(cps.length, 2);
    assert.equal(cps[0].description, "edit a");
    assert.equal(cps[1].description, "edit b");
  });
});

test("getAffectedFiles extracts paths for FileWrite", () => {
  const files = getAffectedFiles("FileWrite", { file_path: "/tmp/test.ts" });
  assert.deepEqual(files, ["/tmp/test.ts"]);
});

test("getAffectedFiles extracts paths for Edit", () => {
  const files = getAffectedFiles("Edit", { file_path: "/tmp/edit.ts" });
  assert.deepEqual(files, ["/tmp/edit.ts"]);
});

test("getAffectedFiles returns empty for unknown tool", () => {
  const files = getAffectedFiles("SomeTool", { data: "test" });
  assert.deepEqual(files, []);
});
