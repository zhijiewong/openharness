import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  autoCommitAIEdits,
  gitBranch,
  gitCommit,
  gitLog,
  gitRoot,
  gitUndo,
  hasUncommittedChanges,
  hasWorktreeChanges,
  isGitRepo,
} from "./index.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "oh-git-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function writeAndStage(dir: string, file: string, content = "hello"): void {
  writeFileSync(join(dir, file), content);
  execSync(`git add ${file}`, { cwd: dir, stdio: "pipe" });
}

function initialCommit(dir: string): void {
  writeAndStage(dir, "README.md", "init");
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
}

// ── isGitRepo ──

test("isGitRepo() returns true inside a git repo", () => {
  const dir = makeRepo();
  assert.equal(isGitRepo(dir), true);
});

test("isGitRepo() returns false outside a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "oh-no-git-"));
  assert.equal(isGitRepo(dir), false);
});

// ── gitBranch ──

test("gitBranch() returns a non-empty string", () => {
  const dir = makeRepo();
  initialCommit(dir);
  const branch = gitBranch(dir);
  assert.ok(branch.length > 0);
});

// ── hasUncommittedChanges ──

test("hasUncommittedChanges() false on clean repo", () => {
  const dir = makeRepo();
  initialCommit(dir);
  assert.equal(hasUncommittedChanges(dir), false);
});

test("hasUncommittedChanges() true with unstaged changes", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeFileSync(join(dir, "new.txt"), "content");
  assert.equal(hasUncommittedChanges(dir), true);
});

// ── gitCommit ──

test("gitCommit() creates a commit", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeAndStage(dir, "file.txt");
  const ok = gitCommit("test commit", dir);
  assert.equal(ok, true);
  const log = gitLog(1, dir);
  assert.ok(log.includes("test commit"));
});

// ── gitUndo ──

test("gitUndo() reverts last oh: commit", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeAndStage(dir, "ai.txt");
  execSync('git commit -m "oh: Edit ai.txt"', { cwd: dir, stdio: "pipe" });
  const ok = gitUndo(dir);
  assert.equal(ok, true);
  // File should be unstaged now
  assert.equal(hasUncommittedChanges(dir), true);
});

test("gitUndo() refuses to revert non-oh: commit", () => {
  const dir = makeRepo();
  initialCommit(dir);
  const ok = gitUndo(dir);
  assert.equal(ok, false);
});

// ── autoCommitAIEdits ──

test("autoCommitAIEdits() commits a specific file", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeFileSync(join(dir, "edit.ts"), "const x = 1;");
  const hash = autoCommitAIEdits("Edit", ["edit.ts"], dir);
  assert.ok(hash !== null, "should return commit hash");
  const log = gitLog(1, dir);
  assert.ok(log.includes("oh: Edit"));
});

test("autoCommitAIEdits() returns null when nothing to commit", () => {
  const dir = makeRepo();
  initialCommit(dir);
  const hash = autoCommitAIEdits("Edit", ["nonexistent.ts"], dir);
  assert.equal(hash, null);
});

test("autoCommitAIEdits() with empty files uses git add -u", () => {
  const dir = makeRepo();
  initialCommit(dir);
  // Modify a tracked file without specifying it
  writeFileSync(join(dir, "README.md"), "modified");
  const hash = autoCommitAIEdits("Bash", [], dir);
  assert.ok(hash !== null, "should commit modified tracked files");
  const log = gitLog(1, dir);
  assert.ok(log.includes("oh: Bash"));
});

test("autoCommitAIEdits() returns null in non-git directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "oh-no-git-"));
  const hash = autoCommitAIEdits("Edit", ["file.ts"], dir);
  assert.equal(hash, null);
});

// ── gitRoot ──

test("gitRoot() returns repo root path", () => {
  const dir = makeRepo();
  const root = gitRoot(dir);
  assert.ok(root !== null);
  assert.ok(root.length > 0);
});

test("gitRoot() returns null outside git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "oh-no-git-"));
  assert.equal(gitRoot(dir), null);
});

// ── hasWorktreeChanges ──

test("hasWorktreeChanges() false on clean repo", () => {
  const dir = makeRepo();
  initialCommit(dir);
  assert.equal(hasWorktreeChanges(dir), false);
});

test("hasWorktreeChanges() true with uncommitted changes", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeFileSync(join(dir, "dirty.txt"), "dirty");
  assert.equal(hasWorktreeChanges(dir), true);
});

// ── autoCommitAIEdits Co-Authored-By ──

test("autoCommitAIEdits() includes Co-Authored-By trailer", () => {
  const dir = makeRepo();
  initialCommit(dir);
  writeFileSync(join(dir, "edit.ts"), "const x = 1;");
  autoCommitAIEdits("Edit", ["edit.ts"], dir);
  const fullMsg = execSync("git log -1 --pretty=%B", { cwd: dir, stdio: "pipe" }).toString();
  assert.ok(fullMsg.includes("Co-Authored-By"));
});
