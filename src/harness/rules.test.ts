import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules, createRulesFile } from "./rules.js";

test("loadRules() returns empty array when no .oh dir exists", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const rules = loadRules(tmp);
  assert.deepEqual(rules, []);
});

test("createRulesFile() creates .oh/RULES.md", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const path = createRulesFile(tmp);
  assert.ok(existsSync(path));
  assert.ok(path.endsWith("RULES.md"));
});

test("loadRules() finds created file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  createRulesFile(tmp);
  const rules = loadRules(tmp);
  assert.equal(rules.length, 1);
  assert.ok(rules[0]!.includes("Project Rules"));
});
