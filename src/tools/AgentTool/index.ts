import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { createWorktree, removeWorktree, isGitRepo } from "../../git/index.js";

const inputSchema = z.object({
  prompt: z.string(),
  description: z.string().optional(),
  isolated: z.boolean().optional(),
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

    // Worktree isolation: create isolated copy of repo if requested or if in git repo
    const useWorktree = input.isolated !== false && isGitRepo(context.workingDir);
    let worktreePath: string | null = null;
    let agentWorkingDir = context.workingDir;

    if (useWorktree) {
      worktreePath = createWorktree(context.workingDir);
      if (worktreePath) {
        agentWorkingDir = worktreePath;
      }
    }

    const systemPrompt = context.systemPrompt ?? "You are a sub-agent. Complete the delegated task concisely.";
    const config = {
      provider: context.provider,
      tools: context.tools,
      systemPrompt,
      permissionMode: context.permissionMode ?? "trust",
      model: context.model,
      maxTurns: 20,
      abortSignal: context.abortSignal,
    };

    const outputChunks: string[] = [];
    let finalText = "";

    try {
      // Override process.cwd for the sub-agent by setting workingDir in tool context
      const originalCwd = process.cwd();
      if (worktreePath) {
        try { process.chdir(agentWorkingDir); } catch { /* ignore */ }
      }

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
      } finally {
        // Restore original working directory
        if (worktreePath) {
          try { process.chdir(originalCwd); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      return {
        output: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    } finally {
      // Clean up worktree
      if (worktreePath) {
        removeWorktree(worktreePath, context.workingDir);
      }
    }

    return { output: finalText || "(sub-agent completed with no text output)", isError: false };
  },

  prompt() {
    return `Spawn a sub-agent with its own tool-use loop to handle a delegated task autonomously. The sub-agent runs in an isolated git worktree to prevent file conflicts. Parameters:
- prompt (string, required): The full instructions for the sub-agent.
- description (string, optional): A short label for what the sub-agent is doing.
- isolated (boolean, optional): Whether to use git worktree isolation (default: true if in a git repo).`;
  },
};
