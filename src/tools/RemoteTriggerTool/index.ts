import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  url: z.string().describe("Webhook URL to trigger"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  body: z.string().optional().describe("JSON body for POST/PUT requests"),
  headers: z.record(z.string()).optional().describe("Custom headers"),
});

export const RemoteTriggerTool: Tool<typeof inputSchema> = {
  name: "RemoteTrigger",
  description: "Trigger a remote webhook or API endpoint. Useful for CI/CD, deployments, and external integrations.",
  inputSchema,
  riskLevel: "high",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input): Promise<ToolResult> {
    try {
      const method = input.method ?? (input.body ? "POST" : "GET");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...input.headers,
      };

      const res = await fetch(input.url, {
        method,
        headers,
        body: input.body,
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text();
      const truncated = text.length > 5000 ? `${text.slice(0, 5000)}\n[truncated]` : text;
      return {
        output: `${res.status} ${res.statusText}\n${truncated}`,
        isError: res.status >= 400,
      };
    } catch (err) {
      return { output: `Request failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  prompt() {
    return "RemoteTrigger: Send HTTP requests to webhooks, APIs, or CI/CD triggers.";
  },
};
