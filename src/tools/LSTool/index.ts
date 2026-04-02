import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  path: z.string().optional(),
});

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

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => {
        // Directories first, then files, both alphabetically
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const lines: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          lines.push(`${entry.name}/`);
        } else {
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            const size = stat.size < 1024
              ? `${stat.size}B`
              : stat.size < 1024 * 1024
              ? `${(stat.size / 1024).toFixed(1)}K`
              : `${(stat.size / 1024 / 1024).toFixed(1)}M`;
            lines.push(`${entry.name.padEnd(40)} ${size}`);
          } catch {
            lines.push(entry.name);
          }
        }
      }

      if (lines.length === 0) return { output: "(empty directory)", isError: false };
      return { output: lines.join("\n"), isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") return { output: `Error: Directory not found: ${dir}`, isError: true };
      if (err.code === "ENOTDIR") return { output: `Error: Not a directory: ${dir}`, isError: true };
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `List the contents of a directory. Parameters:
- path (string, optional): Directory to list (default: working directory).
Directories are shown with a trailing slash and listed first. Files show their size.`;
  },
};
