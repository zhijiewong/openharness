import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  notebook_path: z.string(),
  cell_index: z.number(),
  new_source: z.string(),
});

export const NotebookEditTool: Tool<typeof inputSchema> = {
  name: "NotebookEdit",
  description: "Edit a cell in a Jupyter notebook (.ipynb) file.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context): Promise<ToolResult> {
    const filePath = path.resolve(context.workingDir, input.notebook_path);
    // Path containment — must stay within working directory
    if (!filePath.startsWith(path.resolve(context.workingDir))) {
      return { output: "Error: Path must be within the working directory.", isError: true };
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const notebook = JSON.parse(content);

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { output: "Error: Invalid notebook format — no cells array.", isError: true };
      }

      if (input.cell_index < 0 || input.cell_index >= notebook.cells.length) {
        return {
          output: `Error: Cell index ${input.cell_index} out of range (0-${notebook.cells.length - 1}).`,
          isError: true,
        };
      }

      // Notebook cell source is an array of lines
      const lines = input.new_source.split("\n").map((line, i, arr) =>
        i < arr.length - 1 ? line + "\n" : line
      );
      notebook.cells[input.cell_index].source = lines;

      await fs.writeFile(filePath, JSON.stringify(notebook, null, 1), "utf-8");

      return {
        output: `Cell ${input.cell_index} updated in ${filePath}.`,
        isError: false,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: `Error: Notebook not found: ${filePath}`, isError: true };
      }
      return { output: `Error editing notebook: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Edit a cell in a Jupyter notebook (.ipynb). Parameters:
- notebook_path (string, required): Path to the .ipynb file.
- cell_index (number, required): Zero-based index of the cell to edit.
- new_source (string, required): The new source code for the cell.`;
  },
};
