import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { walkDir, matchGlob } from "../../utils/fs.js";

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

const MAX_RESULTS = 500;

export const GlobTool: Tool<typeof inputSchema> = {
  name: "Glob",
  description: "Find files matching a glob pattern.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, context): Promise<ToolResult> {
    const baseDir = input.path
      ? path.isAbsolute(input.path)
        ? input.path
        : path.resolve(context.workingDir, input.path)
      : context.workingDir;

    try {
      // Try Node 22+ fs.glob first
      if (typeof (fs as any).glob === "function") {
        const matches: string[] = [];
        for await (const entry of (fs as any).glob(input.pattern, { cwd: baseDir })) {
          matches.push(entry as string);
          if (matches.length >= MAX_RESULTS) break;
        }
        matches.sort();
        return {
          output: matches.length
            ? matches.join("\n")
            : "No files matched the pattern.",
          isError: false,
        };
      }

      // Fallback: recursive readdir + pattern match
      const allFiles = await walkDir(baseDir);
      const relative = allFiles.map((f) => path.relative(baseDir, f));
      const matched = relative
        .filter((f) => matchGlob(f, input.pattern))
        .slice(0, MAX_RESULTS)
        .sort();

      return {
        output: matched.length
          ? matched.join("\n")
          : "No files matched the pattern.",
        isError: false,
      };
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Fast file pattern matching tool. Use this instead of running 'find' or 'ls' via Bash. Parameters:
- pattern (string, required): Glob pattern (e.g. "**/*.ts", "src/**/*.js", "*.config.*").
- path (string, optional): Base directory to search in (default: working directory).
Returns up to 500 matching file paths, sorted alphabetically. Supports ** for recursive matching.`;
  },
};
