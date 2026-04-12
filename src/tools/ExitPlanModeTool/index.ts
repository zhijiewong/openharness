import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  allowedPrompts: z
    .array(
      z.object({
        tool: z.enum(["Bash"]).describe("The tool this prompt applies to"),
        prompt: z.string().describe("Semantic description of the action, e.g. 'run tests', 'install dependencies'"),
      }),
    )
    .optional()
    .describe("Prompt-based permissions needed to implement the plan"),
});

export const ExitPlanModeTool: Tool<typeof inputSchema> = {
  name: "ExitPlanMode",
  description: "Exit plan mode and signal that the plan is ready for user approval.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, _context): Promise<ToolResult> {
    const parts = ["Plan mode exited. Plan is ready for review."];
    if (input.allowedPrompts?.length) {
      parts.push("Requested permissions:");
      for (const p of input.allowedPrompts) {
        parts.push(`  - ${p.tool}: ${p.prompt}`);
      }
    }
    return { output: parts.join("\n"), isError: false };
  },

  prompt() {
    return `Exit plan mode and signal that the plan is ready for user approval. Optionally specify allowedPrompts to pre-authorize specific actions (e.g., running tests) during plan execution.`;
  },
};
