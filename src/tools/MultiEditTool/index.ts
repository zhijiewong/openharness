import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const editSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
});

const inputSchema = z.object({
  edits: z.array(editSchema).describe("Array of edits to apply atomically"),
});

export const MultiEditTool: Tool<typeof inputSchema> = {
  name: "MultiEdit",
  description:
    "Apply multiple file edits atomically. All edits succeed or none do. Useful for coordinated changes across files.",
  inputSchema,
  riskLevel: "medium",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(input): Promise<ToolResult> {
    // Phase 1: Validate all edits can be applied
    const originals = new Map<string, string>();
    const modified = new Map<string, string>();

    for (const edit of input.edits) {
      if (!existsSync(edit.file_path)) {
        return { output: `File not found: ${edit.file_path}`, isError: true };
      }
      if (!originals.has(edit.file_path)) {
        originals.set(edit.file_path, readFileSync(edit.file_path, "utf-8"));
      }
      const current = modified.get(edit.file_path) ?? originals.get(edit.file_path)!;
      if (!current.includes(edit.old_string)) {
        return {
          output: `old_string not found in ${edit.file_path}: "${edit.old_string.slice(0, 80)}"`,
          isError: true,
        };
      }
      modified.set(edit.file_path, current.replace(edit.old_string, edit.new_string));
    }

    // Phase 2: Apply all edits
    const results: string[] = [];
    for (const [path, content] of modified) {
      writeFileSync(path, content);
      results.push(path);
    }

    return {
      output: `Applied ${input.edits.length} edit(s) across ${results.length} file(s): ${results.join(", ")}`,
      isError: false,
    };
  },

  prompt() {
    return "MultiEdit: Apply multiple file edits atomically. All succeed or none do.";
  },
};
