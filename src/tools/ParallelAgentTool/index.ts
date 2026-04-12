import { z } from "zod";
import { AgentDispatcher, type AgentTask } from "../../services/AgentDispatcher.js";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const taskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  description: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
});

const inputSchema = z.object({
  tasks: z.array(taskSchema).min(1),
});

export const ParallelAgentTool: Tool<typeof inputSchema> = {
  name: "ParallelAgents",
  description: "Dispatch multiple sub-agents in parallel with optional task dependencies.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(input, context: ToolContext): Promise<ToolResult> {
    if (!context.provider || !context.tools) {
      return { output: "Parallel agents unavailable: provider not in context.", isError: true };
    }

    const systemPrompt = context.systemPrompt ?? "You are a sub-agent. Complete the delegated task concisely.";
    const dispatcher = new AgentDispatcher(
      context.provider,
      context.tools,
      systemPrompt,
      context.permissionMode ?? "trust",
      context.model,
      context.workingDir,
      context.abortSignal,
    );

    dispatcher.addTasks(input.tasks as AgentTask[]);
    const results = await dispatcher.execute();

    const output = results
      .map((r) => {
        const status = r.isError ? "✗" : "✓";
        const duration = (r.durationMs / 1000).toFixed(1);
        return `${status} [${r.id}] (${duration}s)\n${r.output}`;
      })
      .join("\n\n---\n\n");

    const hasErrors = results.some((r) => r.isError);
    return { output, isError: hasErrors };
  },

  prompt() {
    return `Dispatch multiple sub-agents in parallel with optional task dependencies. Each agent runs in an isolated git worktree. Tasks with blockedBy wait for their dependencies to complete before starting.

Parameters:
- tasks (array, required): List of tasks to execute. Each task has:
  - id (string): Unique task identifier
  - prompt (string): Instructions for the sub-agent
  - description (string, optional): Short label
  - blockedBy (string[], optional): IDs of tasks that must complete first

Example: Run task A and B in parallel, then task C after both complete:
tasks: [
  { id: "a", prompt: "..." },
  { id: "b", prompt: "..." },
  { id: "c", prompt: "...", blockedBy: ["a", "b"] }
]`;
  },
};
