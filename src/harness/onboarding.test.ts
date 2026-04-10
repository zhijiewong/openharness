/**
 * Tests for project auto-detection and system prompt generation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject, projectContextToPrompt } from "./onboarding.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "oh-onboard-test-"));
}

// ── detectProject ──

test("detectProject() detects JavaScript via package.json", () => {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), "{}");
  const ctx = detectProject(dir);
  assert.equal(ctx.language, "javascript");
  assert.equal(ctx.packageManager, "npm");
});

test("detectProject() detects Python via pyproject.toml", () => {
  const dir = tmp();
  writeFileSync(join(dir, "pyproject.toml"), "[project]");
  const ctx = detectProject(dir);
  assert.equal(ctx.language, "python");
});

test("detectProject() detects Rust via Cargo.toml", () => {
  const dir = tmp();
  writeFileSync(join(dir, "Cargo.toml"), "[package]");
  const ctx = detectProject(dir);
  assert.equal(ctx.language, "rust");
  assert.equal(ctx.testRunner, "cargo test");
});

test("detectProject() detects Go via go.mod", () => {
  const dir = tmp();
  writeFileSync(join(dir, "go.mod"), "module example.com/foo");
  const ctx = detectProject(dir);
  assert.equal(ctx.language, "go");
});

test("detectProject() returns unknown for empty dir", () => {
  const dir = tmp();
  const ctx = detectProject(dir);
  assert.equal(ctx.language, "unknown");
});

test("detectProject() detects framework from config files", () => {
  const dir = tmp();
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "next.config.js"), "module.exports = {}");
  const ctx = detectProject(dir);
  assert.equal(ctx.framework, "Next.js");
});

test("detectProject() detects README", () => {
  const dir = tmp();
  writeFileSync(join(dir, "README.md"), "# My Project\nA cool project");
  const ctx = detectProject(dir);
  assert.equal(ctx.hasReadme, true);
  assert.equal(ctx.description, "My Project");
});

test("detectProject() detects git repo", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  const ctx = detectProject(dir);
  assert.equal(ctx.hasGit, true);
});

// ── projectContextToPrompt ──

test("projectContextToPrompt() includes platform info", () => {
  const dir = tmp();
  const ctx = detectProject(dir);
  const prompt = projectContextToPrompt(ctx);
  assert.ok(prompt.includes("Platform:"));
  assert.ok(prompt.includes("Shell:"));
  assert.ok(prompt.includes("Current date:"));
});

test("projectContextToPrompt() includes model when provided", () => {
  const dir = tmp();
  const ctx = detectProject(dir);
  const prompt = projectContextToPrompt(ctx, "gpt-4o");
  assert.ok(prompt.includes("Model: gpt-4o"));
});

test("projectContextToPrompt() includes language when detected", () => {
  const dir = tmp();
  writeFileSync(join(dir, "Cargo.toml"), "[package]");
  const ctx = detectProject(dir);
  const prompt = projectContextToPrompt(ctx);
  assert.ok(prompt.includes("rust"));
});

test("projectContextToPrompt() includes working directory", () => {
  const dir = tmp();
  const ctx = detectProject(dir);
  const prompt = projectContextToPrompt(ctx);
  assert.ok(prompt.includes("Primary working directory:"));
});
