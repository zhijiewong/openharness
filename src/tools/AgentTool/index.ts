import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  prompt: z.string(),
  description: z.string().optional(),
});

export const AgentTool: Tool<typeof inputSchema> = {
  name: "Agent",
  description: "Spawn a sub-agent with its own query loop to handle a delegated task.",
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
      return {
        output: "Sub-agent unavailable: provider not in context. Handle this task directly instead.",
        isError: true,
      };
    }

    const { query } = await import("../../query.js");

    const systemPrompt = context.systemPrompt ?? "You are a sub-agent. Complete the delegated task concisely.";
    const config = {
      provider: context.provider,
      tools: context.tools,
      systemPrompt,
      permissionMode: "trust" as const, // sub-agents inherit trust from parent
      model: context.model,
      maxTurns: 20,
      abortSignal: context.abortSignal,
    };

    const outputChunks: string[] = [];
    let finalText = "";

    try {
      for await (const event of query(input.prompt, config)) {
        if (event.type === "text_delta") {
          finalText += event.content;
        } else if (event.type === "tool_output_delta") {
          outputChunks.push(event.chunk);
          if (context.onOutputChunk && context.callId) {
            context.onOutputChunk(context.callId, event.chunk);
          }
        } else if (event.type === "error") {
          return { output: `Sub-agent error: ${event.message}`, isError: true };
        } else if (event.type === "turn_complete" && event.reason !== "completed") {
          if (event.reason === "aborted") {
            return { output: finalText || "Sub-agent aborted.", isError: false };
          }
        }
      }
    } catch (err) {
      return {
        output: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    return { output: finalText || "(sub-agent completed with no text output)", isError: false };
  },

  prompt() {
    return `Spawn a sub-agent with its own tool-use loop to handle a delegated task autonomously. Use this when a task is large enough to warrant isolation. Parameters:
- prompt (string, required): The full instructions for the sub-agent.
- description (string, optional): A short label for what the sub-agent is doing.`;
  },
};
