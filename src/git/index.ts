/**
 * Git integration — auto-commit AI edits, undo, diff.
 * Inspired by Aider's git-native workflow.
 */

import { execSync, spawnSync } from "node:child_process";

/**
 * Check if we're in a git repository.
 */
export function isGitRepo(cwd?: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name.
 */
export function gitBranch(cwd?: string): string {
  try {
    return execSync("git branch --show-current", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

/**
 * Check if there are uncommitted changes.
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  try {
    const output = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString().trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get list of modified files (unstaged + staged).
 */
export function getModifiedFiles(cwd?: string): string[] {
  try {
    const staged = execSync("git diff --cached --name-only", { cwd, stdio: "pipe" }).toString().trim();
    const unstaged = execSync("git diff --name-only", { cwd, stdio: "pipe" }).toString().trim();
    const output = [staged, unstaged].filter(Boolean).join("\n");
    return output ? [...new Set(output.split("\n"))] : [];
  } catch {
    return [];
  }
}

/**
 * Get diff of uncommitted changes.
 */
export function gitDiff(cwd?: string): string {
  try {
    return execSync("git diff", { cwd, stdio: "pipe" }).toString();
  } catch {
    return "";
  }
}

/**
 * Commit all staged + unstaged changes with a message.
 * Stages all modified files first.
 */
export function gitCommit(message: string, cwd?: string): boolean {
  try {
    execSync("git add -A", { cwd, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", message, "--allow-empty"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-commit AI edits with a descriptive message.
 * Returns the commit hash or null on failure.
 */
export function autoCommitAIEdits(
  toolName: string,
  files: string[],
  cwd?: string,
): string | null {
  if (!isGitRepo(cwd)) return null;

  try {
    if (files.length > 0) {
      // Stage only the files the AI touched
      for (const file of files) {
        try {
          execSync(`git add ${JSON.stringify(file)}`, { cwd, stdio: "pipe" });
        } catch {
          // File might not exist (deleted)
        }
      }
    } else {
      // Bash or unknown tool — stage all modified tracked files
      execSync("git add -u", { cwd, stdio: "pipe" });
    }

    // Nothing staged? Skip commit.
    const staged = execSync("git diff --cached --name-only", { cwd, stdio: "pipe" }).toString().trim();
    if (!staged) return null;

    // Generate commit message
    const fileList = files.length > 0
      ? (files.length <= 3 ? files.join(", ") : `${files.length} files`)
      : staged.split("\n").slice(0, 3).join(", ");
    const message = `oh: ${toolName} ${fileList}`;

    spawnSync("git", ["commit", "-m", message], { cwd, stdio: "pipe" });

    // Return commit hash
    return execSync("git rev-parse --short HEAD", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Undo the last commit (soft reset — keeps changes unstaged).
 */
export function gitUndo(cwd?: string): boolean {
  try {
    // Only undo if the last commit was made by OpenHarness
    const lastMessage = execSync("git log -1 --pretty=%s", { cwd, stdio: "pipe" }).toString().trim();
    if (!lastMessage.startsWith("oh:")) {
      return false; // Don't undo non-OH commits
    }
    execSync("git reset --soft HEAD~1", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get short log of recent commits.
 */
export function gitLog(count: number = 5, cwd?: string): string {
  try {
    return execSync(`git log --oneline -${count}`, { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

/**
 * Commit user's dirty files before AI edits (Aider pattern).
 */
export function commitDirtyFiles(cwd?: string): boolean {
  if (!isGitRepo(cwd) || !hasUncommittedChanges(cwd)) return false;
  try {
    execSync("git add -A", { cwd, stdio: "pipe" });
    execSync('git commit -m "wip: save before AI edits"', { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
