import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
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

// ── CLAUDE.md support ──

test("loadRules() picks up CLAUDE.md in project root", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  writeFileSync(join(tmp, "CLAUDE.md"), "Always use TypeScript");
  const rules = loadRules(tmp);
  assert.ok(rules.some(r => r.includes("Always use TypeScript")));
});

test("loadRules() picks up CLAUDE.local.md", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  writeFileSync(join(tmp, "CLAUDE.local.md"), "My personal overrides");
  const rules = loadRules(tmp);
  assert.ok(rules.some(r => r.includes("My personal overrides")));
});

test("loadRules() loads both CLAUDE.md and .oh/RULES.md", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  writeFileSync(join(tmp, "CLAUDE.md"), "Claude rule");
  createRulesFile(tmp);
  const rules = loadRules(tmp);
  assert.ok(rules.some(r => r.includes("Claude rule")));
  assert.ok(rules.some(r => r.includes("Project Rules")));
});

test("loadRules() loads .oh/rules/*.md files", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const rulesDir = join(tmp, ".oh", "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "extra.md"), "Extra rule content");
  const rules = loadRules(tmp);
  assert.ok(rules.some(r => r.includes("Extra rule content")));
});
