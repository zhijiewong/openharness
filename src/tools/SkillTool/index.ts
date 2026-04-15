import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { discoverSkills, findSkill } from "../../harness/plugins.js";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  skill: z.string(),
  args: z.string().optional(),
  path: z.string().optional().describe("Path to a supporting file within the skill directory (Level 2)"),
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

    // Early path traversal check for Level 2
    if (input.path && input.path.includes("..")) {
      return { output: "Error: Path traversal not allowed.", isError: true };
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

    // Level 2: supporting file access
    if (input.path) {
      const skillDir = resolve(skill.filePath.replace(/\.md$/, ""));
      const filePath = resolve(skillDir, input.path);
      // Block path traversal via absolute paths, .., or any escape from skillDir
      if (!filePath.startsWith(skillDir)) {
        return { output: "Error: Path traversal not allowed.", isError: true };
      }
      try {
        const content = readFileSync(filePath, "utf-8");
        return { output: content, isError: false };
      } catch {
        return { output: `File not found: ${input.path} (looked in ${skillDir}/)`, isError: true };
      }
    }

    // Track usage (fire-and-forget, don't block skill invocation)
    try {
      let raw = readFileSync(skill.filePath, "utf-8");
      const now = Date.now();
      const usedMatch = raw.match(/^timesUsed:\s*(\d+)$/m);
      const count = usedMatch ? parseInt(usedMatch[1]!) + 1 : 1;
      if (usedMatch) {
        raw = raw.replace(/^timesUsed:\s*\d+$/m, `timesUsed: ${count}`);
      } else {
        const first = raw.indexOf("---");
        const closing = raw.indexOf("---", first + 3);
        if (closing > 0) {
          raw = `${raw.slice(0, closing)}timesUsed: ${count}\nlastUsed: ${now}\n${raw.slice(closing)}`;
        }
      }
      if (raw.match(/^lastUsed:/m)) {
        raw = raw.replace(/^lastUsed:\s*\d+$/m, `lastUsed: ${now}`);
      }
      writeFileSync(skill.filePath, raw);
    } catch { /* don't block on tracking failure */ }

    return { output: skill.content, isError: false };
  },

  prompt() {
    return `Execute a skill by loading its definition. Skills are searched in .oh/skills/ (project) and ~/.oh/skills/ (global). Parameters:
- skill (string, required): The skill name (or "list" to see available skills).
- args (string, optional): Arguments to pass to the skill.
- path (string, optional): Path to a supporting file within the skill's directory (for reference docs, scripts, templates).`;
  },
};
