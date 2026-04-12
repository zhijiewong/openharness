import { z } from "zod";
import { getMessageBus } from "../../services/agent-messaging.js";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  to: z
    .string()
    .describe("Target agent ID or name, or '*' for broadcast. Use a background agent's ID to send it a message."),
  content: z.string().describe("Message content"),
  type: z.enum(["request", "response", "status", "error"]).optional(),
});

export const SendMessageTool: Tool<typeof inputSchema> = {
  name: "SendMessage",
  description:
    "Send a message to another agent. Use for coordination in multi-agent workflows. Can target background agents by ID.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input): Promise<ToolResult> {
    const bus = getMessageBus();

    // Check if target is a background agent
    const bgAgent = bus.getBackgroundAgent(input.to);
    if (bgAgent) {
      bus.sendToBackgroundAgent(input.to, input.content);
      const statusInfo =
        bgAgent.status === "completed"
          ? `Agent completed. Result: ${bgAgent.result?.slice(0, 500) ?? "(no result)"}${(bgAgent.result?.length ?? 0) > 500 ? "..." : ""}`
          : bgAgent.status === "error"
            ? `Agent errored: ${bgAgent.result ?? "unknown error"}`
            : `Agent still running (started ${Math.round((Date.now() - bgAgent.startedAt) / 1000)}s ago)`;
      return { output: `Message queued for background agent ${input.to}.\nStatus: ${statusInfo}`, isError: false };
    }

    // Standard agent messaging
    bus.send({
      from: "lead",
      to: input.to,
      type: input.type ?? "request",
      content: input.content,
    });
    return { output: `Message sent to ${input.to}`, isError: false };
  },

  prompt() {
    return "SendMessage: Send messages to other agents for coordination. Use to: '*' for broadcast, or use a background agent's ID to query its status and send follow-up messages.";
  },
};
