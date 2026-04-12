/**
 * Checkpoints — auto-snapshot files before modifications for safe rewind.
 *
 * Before each file-modifying tool (FileWrite, FileEdit, Bash), the checkpoint
 * system saves copies of affected files. `/rewind` restores the last checkpoint.
 *
 * Storage: .oh/checkpoints/{sessionId}/{turnN}/{relativePath}
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const CHECKPOINTS_DIR = ".oh/checkpoints";
const MAX_CHECKPOINTS = 20; // per session

export type Checkpoint = {
  turn: number;
  timestamp: number;
  files: string[]; // relative paths of saved files
  description: string; // e.g., "FileEdit src/query.ts"
};

let currentSessionId = "";
let checkpointLog: Checkpoint[] = [];

/** Initialize checkpoint system for a session */
export function initCheckpoints(sessionId: string): void {
  currentSessionId = sessionId;
  checkpointLog = [];
  const dir = join(CHECKPOINTS_DIR, sessionId);
  if (existsSync(dir)) {
    // Load existing checkpoint log
    const logPath = join(dir, "log.json");
    if (existsSync(logPath)) {
      try {
        checkpointLog = JSON.parse(readFileSync(logPath, "utf-8"));
      } catch {
        checkpointLog = [];
      }
    }
  }
}

/**
 * Create a checkpoint before modifying files.
 * Saves copies of the specified files so they can be restored later.
 */
export function createCheckpoint(turn: number, filePaths: string[], description: string): Checkpoint | null {
  if (!currentSessionId || filePaths.length === 0) return null;

  const dir = join(CHECKPOINTS_DIR, currentSessionId, `turn-${turn}`);
  mkdirSync(dir, { recursive: true });

  const savedFiles: string[] = [];
  const cwd = process.cwd();

  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;

    const relPath = relative(cwd, filePath);
    const destPath = join(dir, relPath);

    try {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(filePath, destPath);
      savedFiles.push(relPath);
    } catch {
      /* skip unreadable files */
    }
  }

  if (savedFiles.length === 0) return null;

  const checkpoint: Checkpoint = {
    turn,
    timestamp: Date.now(),
    files: savedFiles,
    description,
  };

  checkpointLog.push(checkpoint);

  // Evict old checkpoints
  while (checkpointLog.length > MAX_CHECKPOINTS) {
    const old = checkpointLog.shift()!;
    const oldDir = join(CHECKPOINTS_DIR, currentSessionId, `turn-${old.turn}`);
    try {
      rmSync(oldDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  // Persist log
  const logPath = join(CHECKPOINTS_DIR, currentSessionId, "log.json");
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, JSON.stringify(checkpointLog, null, 2));

  return checkpoint;
}

/**
 * Rewind to the last checkpoint — restore all files from the most recent snapshot.
 * Returns the checkpoint that was restored, or null if no checkpoints.
 */
export function rewindLastCheckpoint(): Checkpoint | null {
  if (checkpointLog.length === 0) return null;

  const checkpoint = checkpointLog.pop()!;
  const dir = join(CHECKPOINTS_DIR, currentSessionId, `turn-${checkpoint.turn}`);
  const cwd = process.cwd();

  for (const relPath of checkpoint.files) {
    const srcPath = join(dir, relPath);
    const destPath = join(cwd, relPath);

    if (existsSync(srcPath)) {
      try {
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(srcPath, destPath);
      } catch {
        /* skip */
      }
    }
  }

  // Clean up the restored checkpoint dir
  try {
    rmSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }

  // Persist updated log
  const logPath = join(CHECKPOINTS_DIR, currentSessionId, "log.json");
  writeFileSync(logPath, JSON.stringify(checkpointLog, null, 2));

  return checkpoint;
}

/** Get the list of available checkpoints */
export function listCheckpoints(): Checkpoint[] {
  return [...checkpointLog];
}

/** Get checkpoint count */
export function checkpointCount(): number {
  return checkpointLog.length;
}

/**
 * Extract file paths from tool input that might be modified.
 * Returns paths that should be checkpointed before the tool runs.
 */
export function getAffectedFiles(toolName: string, toolInput: Record<string, unknown>): string[] {
  switch (toolName) {
    case "FileWrite":
    case "Write":
      return toolInput.file_path ? [String(toolInput.file_path)] : [];
    case "FileEdit":
    case "Edit":
      return toolInput.file_path ? [String(toolInput.file_path)] : [];
    case "NotebookEdit":
      return toolInput.notebook_path ? [String(toolInput.notebook_path)] : [];
    case "Bash": {
      // Extract file paths from bash commands that modify files
      const cmd = String(toolInput.command ?? "");
      const files: string[] = [];
      // Detect redirect targets: > file, >> file
      const redirects = cmd.matchAll(/>{1,2}\s*(\S+)/g);
      for (const m of redirects) if (m[1] && !m[1].startsWith("/dev/")) files.push(m[1]);
      // Detect sed -i targets
      const sedMatch = cmd.match(/sed\s+-i\S*\s+.*\s+(\S+)$/);
      if (sedMatch?.[1]) files.push(sedMatch[1]);
      // Detect mv/cp targets
      const mvMatch = cmd.match(/(?:mv|cp)\s+\S+\s+(\S+)$/);
      if (mvMatch?.[1]) files.push(mvMatch[1]);
      return files.filter((f) => existsSync(f));
    }
    default:
      return [];
  }
}
