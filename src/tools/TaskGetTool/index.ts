import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  taskId: z.number(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
  output?: string;
};

export const TaskGetTool: Tool<typeof inputSchema> = {
  name: "TaskGet",
  description: "Get details of a single task by ID.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
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

      const lines = [
        `Task #${task.id}`,
        `Subject: ${task.subject}`,
        `Status: ${task.status}`,
        `Description: ${task.description}`,
      ];
      if (task.output) {
        lines.push(`Output: ${task.output}`);
      }

      return { output: lines.join("\n"), isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: "Error: No tasks file found.", isError: true };
      }
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Get full details of a single task by ID. Parameters:
- taskId (number, required): The ID of the task to retrieve.`;
  },
};
