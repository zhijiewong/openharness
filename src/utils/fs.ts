/**
 * Shared filesystem utilities — directory walking and glob matching.
 * Used by GrepTool, GlobTool, and other file-scanning tools.
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Recursively walk a directory, returning all file paths.
 * Skips dotfiles, node_modules, and unreadable directories.
 */
export async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkDir(full)));
      } else {
        results.push(full);
      }
    }
  } catch {
    // skip unreadable directories
  }
  return results;
}

/**
 * Match a file path against a glob pattern.
 * Supports **, *, ?, and . escaping.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const escaped = pattern
    .replace(/\\/g, "/")
    .split("")
    .map((c, i, arr) => {
      if (c === "*" && arr[i + 1] === "*") return null;
      if (c === "*" && arr[i - 1] === "*") return "GLOBSTAR";
      if (c === "*") return "[^/]*";
      if (c === "?") return "[^/]";
      if (c === ".") return "\\.";
      return c;
    })
    .filter((c) => c !== null)
    .join("")
    .replace(/GLOBSTAR/g, ".*");
  try {
    return new RegExp("(^|/)" + escaped + "$").test(normalized);
  } catch {
    return normalized.includes(pattern.replace(/\*/g, ""));
  }
}
