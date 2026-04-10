import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  taskId: z.number(),
  reason: z.string().optional(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
  output?: string;
};

export const TaskStopTool: Tool<typeof inputSchema> = {
  name: "TaskStop",
  description: "Stop/cancel a running task.",
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

      if (task.status === "completed" || task.status === "cancelled") {
        return { output: `Task #${task.id} is already ${task.status}.`, isError: false };
      }

      task.status = "cancelled";
      if (input.reason) {
        task.output = (task.output ? task.output + "\n" : "") + `Cancelled: ${input.reason}`;
      }
      await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");

      return { output: `Task #${task.id} cancelled.${input.reason ? ` Reason: ${input.reason}` : ""}`, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: "Error: No tasks file found.", isError: true };
      }
      return { output: `Error: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Stop/cancel a running or pending task. Parameters:
- taskId (number, required): The ID of the task to stop.
- reason (string, optional): Reason for cancellation.`;
  },
};
