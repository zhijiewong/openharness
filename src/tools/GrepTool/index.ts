import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";
import { matchGlob, walkDir } from "../../utils/fs.js";

const inputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  context: z.number().optional(),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
  head_limit: z.number().optional(),
  offset: z.number().optional(),
  multiline: z.boolean().optional(),
  type: z.string().optional(),
  "-i": z.boolean().optional(),
  "-A": z.number().optional(),
  "-B": z.number().optional(),
  "-C": z.number().optional(),
  "-n": z.boolean().optional(),
});

const MAX_MATCHES = 250;

const TYPE_EXTENSIONS: Record<string, string[]> = {
  js: [".js", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  py: [".py", ".pyi"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
  c: [".c", ".h"],
  css: [".css", ".scss", ".sass", ".less"],
  html: [".html", ".htm"],
  json: [".json"],
  yaml: [".yml", ".yaml"],
  md: [".md", ".mdx"],
  ruby: [".rb"],
  php: [".php"],
  swift: [".swift"],
  kotlin: [".kt", ".kts"],
};

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

    const beforeLines = input["-B"] ?? input["-C"] ?? input.context ?? 0;
    const afterLines = input["-A"] ?? input["-C"] ?? input.context ?? 0;
    const outputMode = input.output_mode ?? "files_with_matches";
    const headLimit = input.head_limit ?? MAX_MATCHES;
    const skipOffset = input.offset ?? 0;
    const caseInsensitive = input["-i"] ?? false;
    const showLineNumbers = input["-n"] !== false; // default true

    const flags = `g${caseInsensitive ? "i" : ""}${input.multiline ? "ms" : ""}`;
    let re: RegExp;
    try {
      re = new RegExp(input.pattern, flags);
    } catch (err: any) {
      return { output: `Invalid regex: ${err.message}`, isError: true };
    }

    // File type filter
    const typeExts = input.type ? TYPE_EXTENSIONS[input.type] : undefined;

    try {
      const allFiles = await walkDir(baseDir);
      let files = allFiles;
      if (input.glob) {
        files = files.filter((f) => matchGlob(path.relative(baseDir, f), input.glob!));
      }
      if (typeExts) {
        files = files.filter((f) => typeExts.some((ext) => f.endsWith(ext)));
      }

      // Multiline matching: match against entire file content
      if (input.multiline) {
        const results: string[] = [];
        const fileCounts: Array<{ file: string; count: number }> = [];
        const matchedFiles: string[] = [];
        let totalSkipped = 0;
        let totalCollected = 0;

        for (const file of files) {
          if (totalCollected >= headLimit) break;
          try {
            const content = await fs.readFile(file, "utf-8");
            re.lastIndex = 0;
            const fileMatches = content.match(re);
            if (fileMatches && fileMatches.length > 0) {
              const relPath = path.relative(context.workingDir, file);
              if (totalSkipped < skipOffset) {
                totalSkipped++;
                continue;
              }
              matchedFiles.push(relPath);
              fileCounts.push({ file: relPath, count: fileMatches.length });
              if (outputMode === "content") {
                for (const m of fileMatches) {
                  if (totalCollected >= headLimit) break;
                  results.push(`${relPath}: ${m.slice(0, 500)}`);
                  totalCollected++;
                }
              } else {
                totalCollected++;
              }
            }
          } catch {
            /* skip */
          }
        }

        if (outputMode === "count") {
          return {
            output: fileCounts.map((fc) => `${fc.file}:${fc.count}`).join("\n") || "No matches found.",
            isError: false,
          };
        } else if (outputMode === "files_with_matches") {
          return { output: matchedFiles.join("\n") || "No matches found.", isError: false };
        }
        return { output: results.join("\n") || "No matches found.", isError: false };
      }

      // Line-by-line matching
      const matches: string[] = [];
      const fileCounts: Array<{ file: string; count: number }> = [];
      const matchedFiles: string[] = [];
      let totalEntries = 0;
      let skipped = 0;

      for (const file of files) {
        if (totalEntries >= headLimit) break;
        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");
          const relPath = path.relative(context.workingDir, file);
          let fileMatchCount = 0;
          let fileHasMatch = false;

          for (let i = 0; i < lines.length; i++) {
            if (totalEntries >= headLimit) break;
            re.lastIndex = 0;
            if (re.test(lines[i])) {
              fileMatchCount++;
              if (!fileHasMatch) {
                fileHasMatch = true;
                if (skipped < skipOffset) {
                  skipped++;
                  continue;
                }
                matchedFiles.push(relPath);
              }

              if (outputMode === "content") {
                const start = Math.max(0, i - beforeLines);
                const end = Math.min(lines.length - 1, i + afterLines);
                if (beforeLines > 0 || afterLines > 0) {
                  for (let j = start; j <= end; j++) {
                    const prefix = j === i ? ">" : " ";
                    const lineNum = showLineNumbers ? `${j + 1}:` : "";
                    matches.push(`${relPath}:${lineNum}${prefix} ${lines[j]}`);
                  }
                  matches.push("--");
                } else {
                  const lineNum = showLineNumbers ? `${i + 1}: ` : "";
                  matches.push(`${relPath}:${lineNum}${lines[i]}`);
                }
                totalEntries++;
              }
            }
          }

          if (fileHasMatch) {
            fileCounts.push({ file: relPath, count: fileMatchCount });
            if (outputMode !== "content") totalEntries++;
          }
        } catch {
          // skip binary/unreadable files
        }
      }

      if (outputMode === "count") {
        const output = fileCounts.map((fc) => `${fc.file}:${fc.count}`).join("\n");
        return { output: output || "No matches found.", isError: false };
      }

      if (outputMode === "files_with_matches") {
        return { output: matchedFiles.join("\n") || "No matches found.", isError: false };
      }

      if (matches.length === 0) {
        return { output: "No matches found.", isError: false };
      }

      let output = matches.join("\n");
      if (totalEntries >= headLimit) {
        output += `\n... (limited to ${headLimit} entries)`;
      }
      return { output, isError: false };
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Search file contents using a regular expression. Parameters:
- pattern (string, required): Regex pattern to search for.
- path (string, optional): File or directory to search in (default: working directory).
- glob (string, optional): Glob filter for files (e.g. "*.ts", "**/*.tsx").
- output_mode (string, optional): "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts.
- head_limit (number, optional): Limit results to first N entries (default 250).
- offset (number, optional): Skip first N entries before applying head_limit (default 0).
- multiline (boolean, optional): Enable multiline mode where . matches newlines and patterns can span lines.
- type (string, optional): File type filter (e.g. "js", "py", "rust", "go", "ts", "java", "cpp").
- -i (boolean, optional): Case insensitive search.
- -A (number, optional): Lines to show after each match (content mode only).
- -B (number, optional): Lines to show before each match (content mode only).
- -C (number, optional): Lines to show before and after each match (content mode only).
- -n (boolean, optional): Show line numbers (default true, content mode only).
- context (number, optional): Alias for -C.`;
  },
};
