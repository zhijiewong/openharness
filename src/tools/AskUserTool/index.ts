import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).optional(),
});

export const AskUserTool: Tool<typeof inputSchema> = {
  name: "AskUser",
  description: "Ask the user a question. The REPL will display it as a prompt.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, _context): Promise<ToolResult> {
    let output = `[Question] ${input.question}`;
    if (input.options && input.options.length > 0) {
      output += "\nOptions:\n" + input.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
    }
    return { output, isError: false };
  },

  prompt() {
    return `Ask the user a question. This is a signal to the UI to prompt the user. Parameters:
- question (string, required): The question to ask.
- options (string[], optional): List of options to present.`;
  },
};
