import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
});

export const FileWriteTool: Tool<typeof inputSchema> = {
  name: "Write",
  description: "Write content to a file, creating parent directories as needed.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.workingDir, input.file_path);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, input.content, "utf-8");
      const lineCount = input.content.split("\n").length;
      return {
        output: `Wrote ${filePath} (${lineCount} lines).`,
        isError: false,
      };
    } catch (err: any) {
      return { output: `Error writing file: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Write content to a file, creating parent directories if needed. Parameters:
- file_path (string, required): Absolute or relative path to the file.
- content (string, required): The full content to write.`;
  },
};
