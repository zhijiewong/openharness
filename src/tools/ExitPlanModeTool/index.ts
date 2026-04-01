import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({});

export const ExitPlanModeTool: Tool<typeof inputSchema> = {
  name: "ExitPlanMode",
  description: "Exit plan mode.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(_input, _context): Promise<ToolResult> {
    return { output: "Plan mode exited.", isError: false };
  },

  prompt() {
    return `Exit plan mode. No parameters required.`;
  },
};
