import { z } from "zod";
import { hasWorktreeChanges, removeWorktree } from "../../git/index.js";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  path: z.string().describe("Path to the worktree to remove"),
  force: z.boolean().optional().describe("Force removal even with uncommitted changes"),
});

export const ExitWorktreeTool: Tool<typeof inputSchema> = {
  name: "ExitWorktree",
  description: "Remove a git worktree. Warns if there are uncommitted changes unless force is true.",
  inputSchema,
  riskLevel: "medium",
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(input): Promise<ToolResult> {
    if (!input.force && hasWorktreeChanges(input.path)) {
      return {
        output: `Worktree at ${input.path} has uncommitted changes. Use force: true to remove anyway.`,
        isError: true,
      };
    }
    try {
      removeWorktree(input.path);
      return { output: `Worktree removed: ${input.path}`, isError: false };
    } catch (err) {
      return {
        output: `Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },

  prompt() {
    return "ExitWorktree: Remove a git worktree created by EnterWorktree.";
  },
};
