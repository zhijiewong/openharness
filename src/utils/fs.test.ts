/**
 * Tests for shared filesystem utilities — walkDir and matchGlob.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { matchGlob, walkDir } from "./fs.js";

describe("walkDir", () => {
  it("finds files in a flat directory", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "a.txt", "a");
    writeFile(tmp, "b.txt", "b");
    const files = await walkDir(tmp);
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.endsWith("a.txt")));
    assert.ok(files.some((f) => f.endsWith("b.txt")));
  });

  it("recurses into subdirectories", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "top.txt", "t");
    writeFile(tmp, "sub/nested.txt", "n");
    writeFile(tmp, "sub/deep/deeper.txt", "d");
    const files = await walkDir(tmp);
    assert.equal(files.length, 3);
    assert.ok(files.some((f) => f.endsWith("deeper.txt")));
  });

  it("skips dotfiles and dotdirs", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "visible.txt", "v");
    writeFile(tmp, ".hidden", "h");
    writeFile(tmp, ".git/config", "g");
    const files = await walkDir(tmp);
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith("visible.txt"));
  });

  it("skips node_modules", async () => {
    const tmp = makeTmpDir();
    writeFile(tmp, "src/app.ts", "a");
    writeFile(tmp, "node_modules/pkg/index.js", "b");
    const files = await walkDir(tmp);
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith("app.ts"));
  });

  it("returns empty for nonexistent directory", async () => {
    const files = await walkDir("/nonexistent/path/xyz");
    assert.deepEqual(files, []);
  });

  it("returns empty for empty directory", async () => {
    const tmp = makeTmpDir();
    const files = await walkDir(tmp);
    assert.deepEqual(files, []);
  });
});

describe("matchGlob", () => {
  it("matches simple filename", () => {
    assert.equal(matchGlob("foo.txt", "foo.txt"), true);
    assert.equal(matchGlob("foo.txt", "bar.txt"), false);
  });

  it("matches * wildcard", () => {
    assert.equal(matchGlob("foo.txt", "*.txt"), true);
    assert.equal(matchGlob("foo.js", "*.txt"), false);
  });

  it("matches ** globstar", () => {
    assert.equal(matchGlob("src/utils/fs.ts", "**/*.ts"), true);
    assert.equal(matchGlob("src/utils/fs.js", "**/*.ts"), false);
  });

  it("matches ? single char", () => {
    assert.equal(matchGlob("a.txt", "?.txt"), true);
    assert.equal(matchGlob("ab.txt", "?.txt"), false);
  });

  it("handles dotfiles in pattern", () => {
    assert.equal(matchGlob(".eslintrc.json", ".eslintrc.json"), true);
  });

  it("handles backslash paths (Windows)", () => {
    assert.equal(matchGlob("src\\utils\\fs.ts", "**/*.ts"), true);
  });

  it("matches nested glob patterns", () => {
    assert.equal(matchGlob("src/components/Button.tsx", "src/**/*.tsx"), true);
    assert.equal(matchGlob("test/components/Button.tsx", "src/**/*.tsx"), false);
  });
});
