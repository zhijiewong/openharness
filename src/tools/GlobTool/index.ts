import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

const MAX_RESULTS = 500;

async function walkDir(dir: string): Promise<string[]> {
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
    // skip unreadable dirs
  }
  return results;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\\/g, "/")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\./g, "\\.");
  // Rebuild with escaped dots applied before star conversion artifacts
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
    const re = new RegExp("^" + escaped + "$");
    return re.test(filePath.replace(/\\/g, "/"));
  } catch {
    return filePath.includes(pattern.replace(/\*/g, ""));
  }
}

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
    return `Find files matching a glob pattern. Parameters:
- pattern (string, required): Glob pattern (e.g. "**/*.ts", "src/**/*.js").
- path (string, optional): Base directory to search in (default: working directory).
Returns up to 500 matching file paths, sorted alphabetically.`;
  },
};
