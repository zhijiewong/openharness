import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";
import { safeEnv } from "../../utils/safe-env.js";

const inputSchema = z.object({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().optional(),
  run_in_background: z.boolean().optional(),
});

const MAX_OUTPUT = 100_000;
const _DEFAULT_TIMEOUT = 120_000;
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

    // Background execution: spawn and return immediately
    if (input.run_in_background) {
      const bgId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const proc = spawn(shell, shellArgs, {
        cwd: context.workingDir,
        env: safeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, timeoutMs);

      if (context.abortSignal) {
        context.abortSignal.addEventListener("abort", () => {
          proc.kill("SIGTERM");
        });
      }

      proc.on("close", (code) => {
        clearTimeout(timer);
        let output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        if (output.length > MAX_OUTPUT) {
          output = `${output.slice(0, MAX_OUTPUT)}\n... [truncated]`;
        }
        // Notify via output chunk when background process completes
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, `\n[background:${bgId} completed, exit code ${code}]\n${output}`);
        }
      });

      return Promise.resolve({
        output: `Background process started (id: ${bgId}, pid: ${proc.pid}). You will be notified when it completes.`,
        isError: false,
      });
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn(shell, shellArgs, {
        cwd: context.workingDir,
        env: safeEnv(),
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
        let output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        if (output.length > MAX_OUTPUT) {
          output = `${output.slice(0, MAX_OUTPUT)}\n... [truncated]`;
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
- description (string, optional): A human-readable description of what the command does.
- timeout (number, optional): Timeout in seconds (default 120, max 600).
- run_in_background (boolean, optional): Run the command in the background. Returns immediately with a process ID. You will be notified when it completes.
Output is truncated at 100K characters.`;
  },
};
