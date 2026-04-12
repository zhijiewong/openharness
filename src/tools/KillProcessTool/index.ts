import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  pid: z.number().optional().describe("Process ID to kill"),
  name: z.string().optional().describe("Process name to kill (uses pkill/taskkill)"),
  signal: z.string().optional().describe("Signal to send (default: SIGTERM)"),
});

export const KillProcessTool: Tool<typeof inputSchema> = {
  name: "KillProcess",
  description: "Kill a running process by PID or name. Use for stopping background tasks or stuck processes.",
  inputSchema,
  riskLevel: "high",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input): Promise<ToolResult> {
    if (!input.pid && !input.name) {
      return { output: "Provide either pid or name.", isError: true };
    }

    try {
      if (input.pid) {
        const signal = input.signal ?? "SIGTERM";
        process.kill(input.pid, signal as NodeJS.Signals);
        return { output: `Sent ${signal} to PID ${input.pid}`, isError: false };
      }

      if (input.name) {
        const { execSync } = await import("node:child_process");
        const isWin = process.platform === "win32";
        const cmd = isWin
          ? `taskkill /IM "${input.name}" /F`
          : `pkill ${input.signal ? `-${input.signal}` : ""} "${input.name}"`;
        const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
        return { output: result || `Killed process: ${input.name}`, isError: false };
      }
    } catch (err) {
      return { output: `Failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    return { output: "No process specified.", isError: true };
  },

  prompt() {
    return "KillProcess: Stop a running process by PID or name.";
  },
};
