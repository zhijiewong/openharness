import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  command: z.string().describe("Background command to watch"),
  pattern: z.string().optional().describe("Regex pattern to match output lines"),
  timeout: z.number().optional().describe("Max watch time in ms (default 60000)"),
  maxLines: z.number().optional().describe("Max output lines to collect (default 100)"),
});

export const MonitorTool: Tool<typeof inputSchema> = {
  name: "Monitor",
  description: "Watch a background process and collect output. Optionally filter by regex pattern.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input, context: ToolContext): Promise<ToolResult> {
    const timeout = input.timeout ?? 60_000;
    const maxLines = input.maxLines ?? 100;
    const pattern = input.pattern ? new RegExp(input.pattern) : null;

    return new Promise((resolve) => {
      const lines: string[] = [];
      let settled = false;

      const proc = spawn(input.command, {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          resolve({
            output:
              lines.length > 0
                ? lines.join("\n") +
                  `\n\n[Monitor timed out after ${timeout / 1000}s — ${lines.length} lines collected]`
                : `[Monitor timed out after ${timeout / 1000}s — no output]`,
            isError: false,
          });
        }
      }, timeout);

      const handleLine = (line: string) => {
        if (settled) return;
        if (pattern && !pattern.test(line)) return;
        lines.push(line.trimEnd());

        // Stream output chunk if callback available
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, `${line}\n`);
        }

        if (lines.length >= maxLines) {
          settled = true;
          clearTimeout(timer);
          proc.kill();
          resolve({
            output: `${lines.join("\n")}\n\n[Collected ${maxLines} lines — stopped]`,
            isError: false,
          });
        }
      };

      let stdoutBuffer = "";
      proc.stdout?.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        const parts = stdoutBuffer.split("\n");
        stdoutBuffer = parts.pop() ?? "";
        for (const line of parts) handleLine(line);
      });

      let stderrBuffer = "";
      proc.stderr?.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
        const parts = stderrBuffer.split("\n");
        stderrBuffer = parts.pop() ?? "";
        for (const line of parts) handleLine(line);
      });

      proc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          // Flush remaining buffers
          if (stdoutBuffer) handleLine(stdoutBuffer);
          if (stderrBuffer) handleLine(stderrBuffer);
          resolve({
            output:
              lines.length > 0
                ? `${lines.join("\n")}\n\n[Process exited with code ${code ?? "unknown"} — ${lines.length} lines]`
                : `[Process exited with code ${code ?? "unknown"} — no output]`,
            isError: (code ?? 0) !== 0,
          });
        }
      });

      proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            output: `Monitor error: ${err.message}`,
            isError: true,
          });
        }
      });
    });
  },

  prompt() {
    return `Watch a background process and collect its output. Optionally filter lines by regex pattern.
Parameters:
- command (string, required): The command to run and watch
- pattern (string, optional): Regex to filter output lines
- timeout (number, optional): Max time in ms (default 60000)
- maxLines (number, optional): Max lines to collect (default 100)`;
  },
};
