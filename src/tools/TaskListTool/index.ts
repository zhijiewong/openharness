import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
};

export const TaskListTool: Tool<typeof inputSchema> = {
  name: "TaskList",
  description: "List all tasks from .oh/tasks.json.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(_input, context): Promise<ToolResult> {
    const filePath = path.join(context.workingDir, ".oh", "tasks.json");

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const tasks: Task[] = JSON.parse(content);

      if (tasks.length === 0) {
        return { output: "No tasks found.", isError: false };
      }

      const output = tasks.map((t) => `#${t.id} [${t.status}] ${t.subject}\n   ${t.description}`).join("\n\n");

      return { output, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { output: "No tasks found. Create a task first.", isError: false };
      }
      return { output: `Error listing tasks: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `List all tasks from .oh/tasks.json. No parameters required.`;
  },
};
