import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";
import { getMessageBus } from "../../services/agent-messaging.js";

const inputSchema = z.object({
  to: z.string().describe("Target agent ID, or '*' for broadcast"),
  content: z.string().describe("Message content"),
  type: z.enum(["request", "response", "status", "error"]).optional(),
});

export const SendMessageTool: Tool<typeof inputSchema> = {
  name: "SendMessage",
  description: "Send a message to another agent. Use for coordination in multi-agent workflows.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() { return true; },
  isConcurrencySafe() { return true; },

  async call(input): Promise<ToolResult> {
    const bus = getMessageBus();
    bus.send({
      from: 'lead',
      to: input.to,
      type: input.type ?? 'request',
      content: input.content,
    });
    return { output: `Message sent to ${input.to}`, isError: false };
  },

  prompt() {
    return "SendMessage: Send messages to other agents for coordination. Use to: '*' for broadcast.";
  },
};
