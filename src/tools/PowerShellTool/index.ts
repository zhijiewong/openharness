import { execSync } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  command: z.string().describe("PowerShell command to execute"),
  timeout: z.number().optional().describe("Timeout in ms (default 120000)"),
});

export const PowerShellTool: Tool<typeof inputSchema> = {
  name: "PowerShell",
  description:
    "Execute PowerShell commands (Windows only). Use for Windows-specific tasks like registry access, COM objects, or .NET calls.",
  inputSchema,
  riskLevel: "high",

  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(input): Promise<ToolResult> {
    if (process.platform !== "win32") {
      return { output: "PowerShell is only available on Windows. Use Bash instead.", isError: true };
    }

    const timeout = input.timeout ?? 120_000;
    try {
      const output = execSync(
        `powershell.exe -NoProfile -NonInteractive -Command "${input.command.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      );
      return { output: output.trim(), isError: false };
    } catch (err: any) {
      const output = String(err.stdout ?? err.stderr ?? err.message ?? "PowerShell error");
      return { output: output.slice(0, 100_000), isError: true };
    }
  },

  prompt() {
    return "Execute PowerShell commands on Windows. Use for registry, COM, .NET, and Windows-specific operations.";
  },
};
