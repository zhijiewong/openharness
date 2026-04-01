import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const FileEditTool: Tool<typeof inputSchema> = {
  name: "Edit",
  description: "Perform string replacement in a file.",
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
      const content = await fs.readFile(filePath, "utf-8");

      if (!content.includes(input.old_string)) {
        return {
          output: `Error: old_string not found in ${filePath}.`,
          isError: true,
        };
      }

      if (!input.replace_all) {
        const firstIdx = content.indexOf(input.old_string);
        const lastIdx = content.lastIndexOf(input.old_string);
        if (firstIdx !== lastIdx) {
          return {
            output: `Error: old_string is not unique in ${filePath} (found multiple occurrences). Use replace_all: true to replace all, or provide more context to make it unique.`,
            isError: true,
          };
        }
      }

      const newContent = input.replace_all
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string);

      await fs.writeFile(filePath, newContent, "utf-8");

      const occurrences = input.replace_all
        ? content.split(input.old_string).length - 1
        : 1;

      return {
        output: `Edited ${filePath}: replaced ${occurrences} occurrence(s).\n--- old\n${input.old_string}\n+++ new\n${input.new_string}`,
        isError: false,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, isError: true };
      }
      return { output: `Error editing file: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Perform exact string replacement in a file. Parameters:
- file_path (string, required): Path to the file to edit.
- old_string (string, required): The exact text to find and replace.
- new_string (string, required): The replacement text.
- replace_all (boolean, optional): Replace all occurrences (default false). If false, old_string must be unique.`;
  },
};
