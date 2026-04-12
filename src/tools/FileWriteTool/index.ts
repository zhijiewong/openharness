import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

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

      // Try exclusive create first to detect overwrites
      let existed = false;
      try {
        await fs.writeFile(filePath, input.content, { encoding: "utf-8", flag: "wx" });
      } catch (wxErr: any) {
        if (wxErr.code === "EEXIST") {
          existed = true;
          await fs.writeFile(filePath, input.content, "utf-8");
        } else {
          throw wxErr;
        }
      }

      const lineCount = input.content.split("\n").length;
      const prefix = existed ? "Overwrote" : "Created";
      return {
        output: `${prefix} ${filePath} (${lineCount} lines).`,
        isError: false,
      };
    } catch (err: any) {
      return { output: `Error writing file: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Write content to a file, creating parent directories if needed. This tool will overwrite existing files.
- file_path (string, required): The absolute path to the file to write.
- content (string, required): The full content to write to the file.
IMPORTANT: Prefer the Edit tool for modifying existing files — it only sends the diff. Only use Write to create new files or for complete rewrites. If the file already exists, you MUST use Read first to understand its current contents.`;
  },
};
