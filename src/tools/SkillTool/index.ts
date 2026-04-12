import { z } from "zod";
import { discoverSkills, findSkill } from "../../harness/plugins.js";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  skill: z.string(),
  args: z.string().optional(),
});

export const SkillTool: Tool<typeof inputSchema> = {
  name: "Skill",
  description: "Execute a skill by loading its definition from project or global skills.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return false;
  },

  async call(input, _context): Promise<ToolResult> {
    // Path traversal protection
    if (input.skill.includes("..") || input.skill.includes("/") || input.skill.includes("\\")) {
      return { output: "Error: Invalid skill name.", isError: true };
    }

    // List skills if "list" or "ls"
    if (input.skill === "list" || input.skill === "ls") {
      const skills = discoverSkills();
      if (skills.length === 0)
        return { output: "No skills found. Create .oh/skills/*.md to add skills.", isError: false };
      const lines = skills.map((s) => `${s.name.padEnd(20)} [${s.source}] ${s.description.slice(0, 50)}`);
      return { output: lines.join("\n"), isError: false };
    }

    // Find skill across all sources
    const skill = findSkill(input.skill);
    if (!skill) {
      const available = discoverSkills()
        .map((s) => s.name)
        .join(", ");
      return {
        output: `Error: Skill "${input.skill}" not found.${available ? ` Available: ${available}` : " Create .oh/skills/*.md to add skills."}`,
        isError: true,
      };
    }

    return { output: skill.content, isError: false };
  },

  prompt() {
    return `Execute a skill by loading its definition. Skills are searched in .oh/skills/ (project) and ~/.oh/skills/ (global). Parameters:
- skill (string, required): The skill name (or "list" to see available skills).
- args (string, optional): Arguments to pass to the skill.`;
  },
};
