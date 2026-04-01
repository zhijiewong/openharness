import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  taskId: z.number(),
  status: z.string().optional(),
  description: z.string().optional(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
};

export const TaskUpdateTool: Tool<typeof inputSchema> = {
  name: "TaskUpdate",
  description: "Update an existing task in .oh/tasks.json.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false; // Mutates shared tasks.json
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

      if (input.status !== undefined) task.status = input.status;
      if (input.description !== undefined) task.description = input.description;

      await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");

      return { output: `Task #${task.id} updated. Status: ${task.status}`, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: "Error: No tasks file found. Create a task first.", isError: true };
      }
      return { output: `Error updating task: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Update an existing task in .oh/tasks.json. Parameters:
- taskId (number, required): The ID of the task to update.
- status (string, optional): New status for the task.
- description (string, optional): New description for the task.`;
  },
};
