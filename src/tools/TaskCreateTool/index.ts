import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

type Task = {
  id: number;
  subject: string;
  description: string;
  status: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  blocks?: number[];
  blockedBy?: number[];
  output?: string;
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
        ...(input.activeForm ? { activeForm: input.activeForm } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
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
- subject (string, required): A brief, actionable title in imperative form (e.g., "Fix authentication bug").
- description (string, required): What needs to be done.
- activeForm (string, optional): Present continuous form shown in spinner when in_progress (e.g., "Fixing authentication bug").
- metadata (object, optional): Arbitrary metadata to attach to the task.
Each task gets an auto-incremented ID and starts with status "pending".`;
  },
};
