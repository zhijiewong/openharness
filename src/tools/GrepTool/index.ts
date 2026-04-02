import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  context: z.number().optional(),
});

const MAX_MATCHES = 100;

function matchGlob(filePath: string, pattern: string): boolean {
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
    // skip unreadable
  }
  return results;
}

export const GrepTool: Tool<typeof inputSchema> = {
  name: "Grep",
  description: "Search file contents using a regex pattern.",
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

    const ctxLines = input.context ?? 0;

    let re: RegExp;
    try {
      re = new RegExp(input.pattern, "g");
    } catch (err: any) {
      return { output: `Invalid regex: ${err.message}`, isError: true };
    }

    try {
      const allFiles = await walkDir(baseDir);
      const files = input.glob
        ? allFiles.filter(f => matchGlob(path.relative(baseDir, f), input.glob!))
        : allFiles;
      const matches: string[] = [];

      for (const file of files) {
        if (matches.length >= MAX_MATCHES) break;
        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");
          const relPath = path.relative(context.workingDir, file);

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            re.lastIndex = 0;
            if (re.test(lines[i])) {
              const start = Math.max(0, i - ctxLines);
              const end = Math.min(lines.length - 1, i + ctxLines);
              if (ctxLines > 0) {
                for (let j = start; j <= end; j++) {
                  const prefix = j === i ? ">" : " ";
                  matches.push(`${relPath}:${j + 1}:${prefix} ${lines[j]}`);
                }
                matches.push("--");
              } else {
                matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
              }
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }

      if (matches.length === 0) {
        return { output: "No matches found.", isError: false };
      }

      let output = matches.join("\n");
      if (matches.length >= MAX_MATCHES) {
        output += "\n... (limited to 100 matches)";
      }
      return { output, isError: false };
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Search file contents using a regular expression. Parameters:
- pattern (string, required): Regex pattern to search for.
- path (string, optional): Directory to search in (default: working directory).
- glob (string, optional): Glob filter for files (e.g. "*.ts").
- context (number, optional): Lines of context to show around matches.
Returns up to 100 matches in file:line format.`;
  },
};
