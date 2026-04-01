import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({});

export const EnterPlanModeTool: Tool<typeof inputSchema> = {
  name: "EnterPlanMode",
  description: "Enter plan mode, creating .oh/plan.md if it does not exist.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(_input, context): Promise<ToolResult> {
    const dir = path.join(context.workingDir, ".oh");
    const filePath = path.join(dir, "plan.md");

    try {
      await fs.mkdir(dir, { recursive: true });

      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, "# Plan\n\n", "utf-8");
      }

      return { output: "Plan mode entered.", isError: false };
    } catch (err: any) {
      return { output: `Error entering plan mode: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Enter plan mode. Creates .oh/plan.md if it does not already exist. No parameters required.`;
  },
};
