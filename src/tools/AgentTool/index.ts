import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  prompt: z.string(),
  description: z.string().optional(),
});

export const AgentTool: Tool<typeof inputSchema> = {
  name: "Agent",
  description: "Spawn a sub-agent to handle a task (stub).",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, _context): Promise<ToolResult> {
    return {
      output: `Sub-agent spawning not yet implemented. Handle this task directly instead of delegating. Prompt was: ${input.prompt}`,
      isError: true,
    };
  },

  prompt() {
    return `Spawn a sub-agent to handle a delegated task. Parameters:
- prompt (string, required): The prompt/instructions for the sub-agent.
- description (string, optional): A short description of what the sub-agent should do.
Note: This is currently a stub and will be implemented later.`;
  },
};
