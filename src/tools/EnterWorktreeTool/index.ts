import { z } from "zod";
import { createWorktree, isGitRepo } from "../../git/index.js";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  branch: z.string().optional().describe("Branch name for the worktree (auto-generated if omitted)"),
});

export const EnterWorktreeTool: Tool<typeof inputSchema> = {
  name: "EnterWorktree",
  description:
    "Create an isolated git worktree for safe experimentation. Changes won't affect the main working directory.",
  inputSchema,
  riskLevel: "medium",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(_input, context: ToolContext): Promise<ToolResult> {
    if (!isGitRepo(context.workingDir)) {
      return { output: "Not a git repository — worktrees require git.", isError: true };
    }
    const path = createWorktree(context.workingDir);
    if (!path) {
      return { output: "Failed to create worktree.", isError: true };
    }
    return { output: `Worktree created at: ${path}\nUse ExitWorktree to clean up when done.`, isError: false };
  },

  prompt() {
    return "EnterWorktree: Create an isolated git worktree for safe code changes.";
  },
};
