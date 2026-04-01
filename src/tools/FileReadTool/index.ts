import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

const DEFAULT_LIMIT = 2000;

export const FileReadTool: Tool<typeof inputSchema> = {
  name: "Read",
  description: "Read a file from the filesystem with optional line range.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, context): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.workingDir, input.file_path);

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        return { output: `Error: ${filePath} is a directory, not a file.`, isError: true };
      }

      const content = await fs.readFile(filePath, "utf-8");
      const allLines = content.split("\n");
      const offset = Math.max(0, (input.offset ?? 1) - 1);
      const limit = input.limit ?? DEFAULT_LIMIT;
      const lines = allLines.slice(offset, offset + limit);

      const numbered = lines
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join("\n");

      const total = allLines.length;
      const shown = lines.length;
      let result = numbered;
      if (shown < total) {
        result += `\n\n(Showing lines ${offset + 1}-${offset + shown} of ${total})`;
      }

      return { output: result, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, isError: true };
      }
      if (err.code === "EACCES") {
        return { output: `Error: Permission denied: ${filePath}`, isError: true };
      }
      return { output: `Error reading file: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Read a file and return its contents with line numbers. Parameters:
- file_path (string, required): Absolute or relative path to the file.
- offset (number, optional): Line number to start from (1-based, default 1).
- limit (number, optional): Maximum number of lines to return (default 2000).`;
  },
};
