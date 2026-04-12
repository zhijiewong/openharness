import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).optional(),
});

export const AskUserTool: Tool<typeof inputSchema> = {
  name: "AskUser",
  description: "Pause and ask the user a question, waiting for their typed response before continuing.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context: ToolContext): Promise<ToolResult> {
    if (context.askUserQuestion) {
      const answer = await context.askUserQuestion(input.question, input.options);
      return { output: answer, isError: false };
    }

    // Headless fallback — return question as text so LLM can see it
    let output = `[AskUser] ${input.question}`;
    if (input.options && input.options.length > 0) {
      output += `\nOptions:\n${input.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}`;
    }
    output += "\n(No interactive session available — please answer in your next message.)";
    return { output, isError: false };
  },

  prompt() {
    return `Pause execution and ask the user a direct question. Wait for their answer before continuing. Use this when you need clarification, a decision, or information only the user can provide. Parameters:
- question (string, required): The question to ask.
- options (string[], optional): Suggested choices to present to the user.`;
  },
};
