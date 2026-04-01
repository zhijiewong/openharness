import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileEditTool } from "./FileEditTool/index.js";

const ctx = { workingDir: process.cwd() };

test("replace string in file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const fp = join(tmp, "test.txt");
  writeFileSync(fp, "hello world");
  const result = await FileEditTool.call(
    { file_path: fp, old_string: "hello", new_string: "goodbye" },
    ctx,
  );
  assert.equal(result.isError, false);
  assert.equal(readFileSync(fp, "utf-8"), "goodbye world");
});

test("returns error when old_string not found", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const fp = join(tmp, "test.txt");
  writeFileSync(fp, "hello world");
  const result = await FileEditTool.call(
    { file_path: fp, old_string: "missing", new_string: "x" },
    ctx,
  );
  assert.equal(result.isError, true);
  assert.ok(result.output.includes("not found"));
});

test("returns error when old_string not unique unless replace_all", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const fp = join(tmp, "test.txt");
  writeFileSync(fp, "aaa bbb aaa");

  const r1 = await FileEditTool.call(
    { file_path: fp, old_string: "aaa", new_string: "ccc" },
    ctx,
  );
  assert.equal(r1.isError, true);
  assert.ok(r1.output.includes("not unique"));

  const r2 = await FileEditTool.call(
    { file_path: fp, old_string: "aaa", new_string: "ccc", replace_all: true },
    ctx,
  );
  assert.equal(r2.isError, false);
  assert.equal(readFileSync(fp, "utf-8"), "ccc bbb ccc");
});
