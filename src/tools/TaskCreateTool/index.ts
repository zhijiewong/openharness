import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  subject: z.string(),
  description: z.string(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
};

export const TaskCreateTool: Tool<typeof inputSchema> = {
  name: "TaskCreate",
  description: "Create a new task and append it to .oh/tasks.json.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false; // Mutates shared tasks.json
  },

  async call(input, context): Promise<ToolResult> {
    const dir = path.join(context.workingDir, ".oh");
    const filePath = path.join(dir, "tasks.json");

    try {
      await fs.mkdir(dir, { recursive: true });

      let tasks: Task[] = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        tasks = JSON.parse(content);
      } catch {
        // File doesn't exist yet
      }

      const maxId = tasks.reduce((max, t) => Math.max(max, t.id), 0);
      const newTask: Task = {
        id: maxId + 1,
        subject: input.subject,
        description: input.description,
        status: "pending",
      };

      tasks.push(newTask);
      await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");

      return { output: `Task #${newTask.id} created: ${newTask.subject}`, isError: false };
    } catch (err: any) {
      return { output: `Error creating task: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Create a new task in .oh/tasks.json. Parameters:
- subject (string, required): Short title for the task.
- description (string, required): Detailed description of the task.
Each task gets an auto-incremented ID and starts with status "pending".`;
  },
};
