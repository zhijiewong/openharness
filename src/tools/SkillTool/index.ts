import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  skill: z.string(),
  args: z.string().optional(),
});

export const SkillTool: Tool<typeof inputSchema> = {
  name: "Skill",
  description: "Execute a skill by reading its definition from .oh/skills/.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return false;
  },

  async call(input, context): Promise<ToolResult> {
    // Path traversal protection
    if (input.skill.includes("..") || input.skill.includes("/") || input.skill.includes("\\")) {
      return { output: "Error: Invalid skill name.", isError: true };
    }
    const baseDir = path.join(context.workingDir, ".oh", "skills");
    const filePath = path.join(baseDir, `${input.skill}.md`);
    if (!filePath.startsWith(baseDir)) {
      return { output: "Error: Invalid skill path.", isError: true };
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { output: content, isError: false };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return {
          output: `Error: Skill "${input.skill}" not found at ${filePath}`,
          isError: true,
        };
      }
      return { output: `Error reading skill: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Execute a skill by loading its definition from .oh/skills/{skill}.md. Parameters:
- skill (string, required): The skill name (maps to a .md file).
- args (string, optional): Arguments to pass to the skill.`;
  },
};
