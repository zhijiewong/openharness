import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  taskId: z.number(),
  output: z.string(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
  output?: string;
};

export const TaskOutputTool: Tool<typeof inputSchema> = {
  name: "TaskOutput",
  description: "Set or append output/result text for a task.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context): Promise<ToolResult> {
    const filePath = path.join(context.workingDir, ".oh", "tasks.json");

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const tasks: Task[] = JSON.parse(content);

      const task = tasks.find((t) => t.id === input.taskId);
      if (!task) {
        return { output: `Error: Task #${input.taskId} not found.`, isError: true };
      }

      task.output = input.output;
      await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");

      return { output: `Task #${task.id} output saved (${input.output.length} chars).`, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: "Error: No tasks file found.", isError: true };
      }
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Set or append output/result text for a task. Parameters:
- taskId (number, required): The ID of the task.
- output (string, required): The output or result text to store.`;
  },
};
