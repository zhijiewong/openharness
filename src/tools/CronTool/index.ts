import { z } from "zod";
import { createCron, deleteCron, listCrons } from "../../services/cron.js";
import type { Tool, ToolResult } from "../../Tool.js";

const createSchema = z.object({
  action: z.literal("create"),
  name: z.string().describe("Human-readable name for this scheduled task"),
  schedule: z.string().describe("Schedule: 'every 5m', 'every 2h', 'every 1d'"),
  prompt: z.string().describe("The prompt to run on schedule"),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  id: z.string().describe("Cron ID to delete"),
});

const listSchema = z.object({
  action: z.literal("list"),
});

const _inputSchema = z.discriminatedUnion("action", [createSchema, deleteSchema, listSchema]);

export const CronCreateTool: Tool<typeof createSchema> = {
  name: "CronCreate",
  description: "Create a scheduled recurring task that runs a prompt on an interval.",
  inputSchema: createSchema,
  riskLevel: "medium",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return true;
  },
  async call(input): Promise<ToolResult> {
    const cron = createCron(input.name, input.schedule, input.prompt);
    return { output: `Created cron '${cron.name}' (${cron.id}) — schedule: ${cron.schedule}`, isError: false };
  },
  prompt() {
    return "CronCreate: Schedule a recurring task. Schedules: 'every 5m', 'every 2h', 'every 1d'.";
  },
};

export const CronDeleteTool: Tool<typeof deleteSchema> = {
  name: "CronDelete",
  description: "Delete a scheduled recurring task.",
  inputSchema: deleteSchema,
  riskLevel: "medium",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return true;
  },
  async call(input): Promise<ToolResult> {
    const ok = deleteCron(input.id);
    return { output: ok ? `Deleted cron ${input.id}` : `Cron ${input.id} not found`, isError: !ok };
  },
  prompt() {
    return "CronDelete: Remove a scheduled task by ID.";
  },
};

export const CronListTool: Tool<typeof listSchema> = {
  name: "CronList",
  description: "List all scheduled recurring tasks.",
  inputSchema: listSchema,
  riskLevel: "low",
  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  async call(): Promise<ToolResult> {
    const crons = listCrons();
    if (crons.length === 0) return { output: "No scheduled tasks.", isError: false };
    const lines = crons.map(
      (c) => `${c.id}  ${c.name.padEnd(20)}  ${c.schedule.padEnd(12)}  ${c.enabled ? "✓" : "✗"}  runs: ${c.runCount}`,
    );
    return { output: `Scheduled tasks:\n${lines.join("\n")}`, isError: false };
  },
  prompt() {
    return "CronList: Show all scheduled recurring tasks.";
  },
};
