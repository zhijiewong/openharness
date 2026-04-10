import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { createWorktree, removeWorktree, hasWorktreeChanges, isGitRepo } from "../../git/index.js";

const inputSchema = z.object({
  prompt: z.string(),
  description: z.string().optional(),
  isolated: z.boolean().optional(),
  run_in_background: z.boolean().optional(),
  model: z.string().optional(),
  subagent_type: z.string().optional(),
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

    // Subagent type modifies the system prompt — check built-in types first, then agent roles
    let systemPrompt = context.systemPrompt ?? "You are a sub-agent. Complete the delegated task concisely.";
    if (input.subagent_type) {
      const builtinHints: Record<string, string> = {
        explore: "You are an exploration agent. Search the codebase to answer questions. Use only read-only tools (Read, Grep, Glob, LS). Do not modify any files.",
        plan: "You are a planning agent. Analyze the codebase and design implementation plans. Use only read-only tools. Return a detailed step-by-step plan.",
      };
      const hint = builtinHints[input.subagent_type.toLowerCase()];
      if (hint) {
        systemPrompt = hint + "\n\n" + systemPrompt;
      } else {
        // Check agent roles (code-reviewer, test-writer, debugger, etc.)
        const { getRole } = await import("../../agents/roles.js");
        const role = getRole(input.subagent_type.toLowerCase());
        if (role) {
          systemPrompt = role.systemPromptSupplement + "\n\n" + systemPrompt;
        }
      }
    }

    // Model override for sub-agent
    const agentModel = input.model ?? context.model;

    const config = {
      provider: context.provider,
      tools: context.tools,
      systemPrompt,
      permissionMode: context.permissionMode ?? "trust",
      model: agentModel,
      maxTurns: 20,
      abortSignal: context.abortSignal,
    };

    // Background execution: start agent and return immediately
    if (input.run_in_background) {
      const bgId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const runAgent = async () => {
        let finalText = "";
        const originalCwd = process.cwd();
        try {
          if (worktreePath) {
            try { process.chdir(agentWorkingDir); } catch { /* ignore */ }
          }
          for await (const event of query(input.prompt, config)) {
            if (event.type === "text_delta") finalText += event.content;
          }
        } finally {
          if (worktreePath) {
            try { process.chdir(originalCwd); } catch { /* ignore */ }
          }
          // Clean up worktree only if no changes were made
          if (worktreePath) {
            const hasChanges = hasWorktreeChanges(worktreePath);
            if (!hasChanges) {
              removeWorktree(worktreePath, context.workingDir);
            } else if (context.onOutputChunk && context.callId) {
              context.onOutputChunk(context.callId, `\n[background:${bgId} worktree preserved at ${worktreePath} — agent made changes]`);
            }
          }
        }
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, `\n[background:${bgId} completed]\n${finalText}`);
        }
      };
      runAgent().catch((err) => {
        if (context.onOutputChunk && context.callId) {
          context.onOutputChunk(context.callId, `\n[background:${bgId} failed: ${err instanceof Error ? err.message : String(err)}]`);
        }
      });
      return {
        output: `Background agent started (id: ${bgId}). You will be notified when it completes.`,
        isError: false,
      };
    }

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
      // Clean up worktree only if no changes were made
      if (worktreePath) {
        const hasChanges = hasWorktreeChanges(worktreePath);
        if (!hasChanges) {
          removeWorktree(worktreePath, context.workingDir);
        } else {
          finalText += `\n\n[Worktree preserved at ${worktreePath} — agent made changes that can be reviewed/merged]`;
        }
      }
    }

    return { output: finalText || "(sub-agent completed with no text output)", isError: false };
  },

  prompt() {
    return `Spawn a sub-agent with its own tool-use loop to handle a delegated task autonomously. The sub-agent runs in an isolated git worktree to prevent file conflicts. Parameters:
- prompt (string, required): The full instructions for the sub-agent.
- description (string, optional): A short label for what the sub-agent is doing.
- isolated (boolean, optional): Whether to use git worktree isolation (default: true if in a git repo).
- run_in_background (boolean, optional): Run the agent in the background. Returns immediately; you will be notified when it completes.
- model (string, optional): Override the model for this sub-agent (e.g., use a faster model for exploration).
- subagent_type (string, optional): Specialize the agent behavior. Types: "Explore" (read-only codebase search), "Plan" (design implementation plans), "code-reviewer" (review code for issues).`;
  },
};
