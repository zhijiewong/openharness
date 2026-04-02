import { z } from "zod";
import { spawn } from "child_process";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional(),
});

const MAX_OUTPUT = 100_000;
const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;

export const BashTool: Tool<typeof inputSchema> = {
  name: "Bash",
  description: "Execute a shell command and return its output.",
  inputSchema,
  riskLevel: "high",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  call(input, context): Promise<ToolResult> {
    // input.timeout is in seconds; convert to ms. Default 120s.
    const timeoutMs = Math.min((input.timeout ?? 120) * 1000, MAX_TIMEOUT);
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWin ? ["/c", input.command] : ["-c", input.command];

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn(shell, shellArgs, {
        cwd: context.workingDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, text);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, text);
        }
      });

      if (context.abortSignal) {
        context.abortSignal.addEventListener("abort", () => {
          proc.kill("SIGTERM");
        });
      }

      proc.on("close", (code) => {
        clearTimeout(timer);
        let output = stdout + (stderr ? "\n[stderr]\n" + stderr : "");
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + "\n... [truncated]";
        }
        if (killed) {
          output += "\n[timed out]";
        }
        resolve({
          output: output || `(exit code ${code})`,
          isError: code !== 0,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ output: `Error spawning process: ${err.message}`, isError: true });
      });
    });
  },

  prompt() {
    return `Execute a bash command and return stdout/stderr. Parameters:
- command (string, required): The shell command to run.
- timeout (number, optional): Timeout in seconds (default 120, max 600).
Output is truncated at 100K characters.`;
  },
};
