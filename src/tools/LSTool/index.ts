import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  path: z.string().optional(),
  depth: z.number().optional(),
});

const MAX_ENTRIES = 500;

async function listDir(dir: string, prefix: string, maxDepth: number, currentDepth: number): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  for (const entry of entries) {
    if (lines.length >= MAX_ENTRIES) break;
    if (entry.name.startsWith(".") && currentDepth > 0) continue; // skip dotfiles in subdirs

    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      if (currentDepth + 1 < maxDepth) {
        const subLines = await listDir(path.join(dir, entry.name), `${prefix}  `, maxDepth, currentDepth + 1);
        lines.push(...subLines);
      }
    } else {
      try {
        const stat = await fs.stat(path.join(dir, entry.name));
        const size =
          stat.size < 1024
            ? `${stat.size}B`
            : stat.size < 1024 * 1024
              ? `${(stat.size / 1024).toFixed(1)}K`
              : `${(stat.size / 1024 / 1024).toFixed(1)}M`;
        lines.push(`${prefix}${entry.name.padEnd(Math.max(1, 40 - prefix.length))} ${size}`);
      } catch {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  }
  return lines;
}

export const LSTool: Tool<typeof inputSchema> = {
  name: "LS",
  description: "List the contents of a directory.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, context): Promise<ToolResult> {
    const dir = input.path
      ? path.isAbsolute(input.path)
        ? input.path
        : path.resolve(context.workingDir, input.path)
      : context.workingDir;

    const maxDepth = input.depth ?? 1;

    try {
      const lines = await listDir(dir, "", maxDepth, 0);

      if (lines.length === 0) return { output: "(empty directory)", isError: false };
      return { output: lines.join("\n"), isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") return { output: `Error: Directory not found: ${dir}`, isError: true };
      if (err.code === "ENOTDIR") return { output: `Error: Not a directory: ${dir}`, isError: true };
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `List the contents of a directory. Use this instead of running 'ls' via Bash. Parameters:
- path (string, optional): Directory to list (default: working directory).
- depth (number, optional): How many levels deep to recurse (default 1 = immediate contents only). Use 2 or 3 for a tree view.
Directories are shown with a trailing slash and listed first. Files show their size. For recursive file discovery by pattern, use the Glob tool instead.`;
  },
};
