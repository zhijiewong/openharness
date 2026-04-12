import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  taskId: z.number(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled", "deleted"]).optional(),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  addBlocks: z.array(z.number()).optional(),
  addBlockedBy: z.array(z.number()).optional(),
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

      // Handle deletion
      if (input.status === "deleted") {
        const idx = tasks.indexOf(task);
        tasks.splice(idx, 1);
        await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");
        return { output: `Task #${input.taskId} deleted.`, isError: false };
      }

      if (input.status !== undefined) task.status = input.status;
      if (input.subject !== undefined) task.subject = input.subject;
      if (input.description !== undefined) task.description = input.description;
      if (input.activeForm !== undefined) task.activeForm = input.activeForm;
      if (input.owner !== undefined) task.owner = input.owner;

      // Merge metadata
      if (input.metadata) {
        task.metadata = task.metadata ?? {};
        for (const [k, v] of Object.entries(input.metadata)) {
          if (v === null) {
            delete task.metadata[k];
          } else {
            task.metadata[k] = v;
          }
        }
      }

      // Add dependency links
      if (input.addBlocks) {
        task.blocks = [...new Set([...(task.blocks ?? []), ...input.addBlocks])];
      }
      if (input.addBlockedBy) {
        task.blockedBy = [...new Set([...(task.blockedBy ?? []), ...input.addBlockedBy])];
      }

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
- status (string, optional): New status — "pending", "in_progress", "completed", "cancelled", or "deleted" (permanently removes).
- subject (string, optional): New title for the task.
- description (string, optional): New description for the task.
- activeForm (string, optional): Present continuous form shown in spinner when in_progress.
- owner (string, optional): Assign an owner (agent name).
- metadata (object, optional): Merge metadata keys into the task. Set a key to null to delete it.
- addBlocks (number[], optional): Task IDs that cannot start until this one completes.
- addBlockedBy (number[], optional): Task IDs that must complete before this one can start.
Status progresses: pending → in_progress → completed. Mark tasks as in_progress BEFORE starting work, completed when done.`;
  },
};
