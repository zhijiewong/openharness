/**
 * Skill management commands — /skills, /skill-create, /skill-delete, /skill-edit, /skill-search, /skill-install
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills } from "../harness/plugins.js";
import type { CommandHandler } from "./types.js";

export function registerSkillCommands(register: (name: string, description: string, handler: CommandHandler) => void) {
  register("skills", "List all available skills", () => {
    const skills = discoverSkills();
    if (skills.length === 0) {
      return {
        output: "No skills found. Create .oh/skills/*.md to add one, or run /skill-search to browse the registry.",
        handled: true,
      };
    }
    // Group by source for readability
    const lines: string[] = ["Available skills:"];
    const sourceLabel: Record<string, string> = {
      project: "[project]",
      global: "[global]",
      plugin: "[plugin]",
    };
    // Sort: bundled-style (project, no path under .oh) first, then by source then name
    const sorted = [...skills].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return a.name.localeCompare(b.name);
    });
    for (const s of sorted) {
      const tag = sourceLabel[s.source] ?? `[${s.source}]`;
      const desc = s.description ? `: ${s.description}` : "";
      lines.push(`  - ${s.name} ${tag}${desc}`);
    }
    return { output: lines.join("\n"), handled: true };
  });

  register("skill-create", "Create a new skill file", (args) => {
    const name = args.trim();
    if (!name) return { output: "Usage: /skill-create <name>", handled: true };
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return { output: "Error: Invalid skill name.", handled: true };
    }

    const dir = join(process.cwd(), ".oh", "skills");
    mkdirSync(dir, { recursive: true });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const filePath = join(dir, `${slug}.md`);

    if (existsSync(filePath)) {
      return { output: `Skill "${slug}" already exists at ${filePath}`, handled: true };
    }

    const template = `---
name: ${slug}
description: Describe what this skill does
trigger: ${slug}
---

# ${name}

## When to Use
Describe when this skill should be triggered.

## Procedure
1. Step one
2. Step two
3. Step three

## Pitfalls
- Common mistakes to avoid

## Verification
How to confirm the skill worked correctly.
`;

    writeFileSync(filePath, template);
    return { output: `Created skill: ${filePath}\nEdit the file to customize it.`, handled: true };
  });

  register("skill-delete", "Delete a skill file", (args) => {
    const name = args.trim();
    if (!name) return { output: "Usage: /skill-delete <name>", handled: true };

    const { findSkill } = require("../harness/plugins.js") as typeof import("../harness/plugins.js");
    const skill = findSkill(name);
    if (!skill) return { output: `Skill "${name}" not found.`, handled: true };

    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(skill.filePath);
      return { output: `Deleted skill: ${skill.filePath}`, handled: true };
    } catch (err: any) {
      return { output: `Error deleting skill: ${err.message}`, handled: true };
    }
  });

  register("skill-edit", "Show skill file path for editing", (args) => {
    const name = args.trim();
    if (!name) return { output: "Usage: /skill-edit <name>", handled: true };

    const { findSkill } = require("../harness/plugins.js") as typeof import("../harness/plugins.js");
    const skill = findSkill(name);
    if (!skill) return { output: `Skill "${name}" not found.`, handled: true };

    return { output: `Skill file: ${skill.filePath}\nEdit this file to update the skill.`, handled: true };
  });

  register("skill-search", "Search the skills registry", (args) => {
    const query = args.trim();
    if (!query) return { output: "Usage: /skill-search <query>", handled: true };

    import("../harness/skill-registry.js").then(async ({ fetchRegistry, searchRegistry }) => {
      try {
        const registry = await fetchRegistry();
        const results = searchRegistry(registry, query);
        if (results.length === 0) {
          console.log(`No skills found matching "${query}".`);
        } else {
          const lines = results.map((s) => `  ${s.name.padEnd(20)} ${s.description} [${s.tags.join(", ")}]`);
          console.log(`Found ${results.length} skill(s):\n${lines.join("\n")}\n\nInstall: /skill-install <name>`);
        }
      } catch (err: any) {
        console.log(`Registry search failed: ${err.message}`);
      }
    });
    return { output: "Searching skills registry...", handled: true };
  });

  register(
    "skill-install",
    "Install a skill from the registry. Use --accept-license=<SPDX> for non-permissive licenses.",
    (args) => {
      // Parse: <name> [--accept-license=<SPDX>]
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0)
        return { output: "Usage: /skill-install <name> [--accept-license=<SPDX>]", handled: true };
      let name = "";
      let acceptLicense: string | undefined;
      for (const tok of tokens) {
        if (tok.startsWith("--accept-license=")) acceptLicense = tok.slice("--accept-license=".length);
        else if (!name) name = tok;
      }
      if (!name) return { output: "Usage: /skill-install <name> [--accept-license=<SPDX>]", handled: true };

      import("../harness/skill-registry.js").then(async ({ fetchRegistry, installSkill }) => {
        try {
          const registry = await fetchRegistry();
          const skill = registry.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
          if (!skill) {
            console.log(`Skill "${name}" not found in registry. Try /skill-search first.`);
            return;
          }
          const result = await installSkill(skill, { acceptLicense });
          if (result.ok) {
            console.log(`Installed skill "${skill.name}" to ${result.filePath}`);
          } else {
            console.log(result.message);
          }
        } catch (err: any) {
          console.log(`Installation failed: ${err.message}`);
        }
      });
      return { output: `Installing skill "${name}"...`, handled: true };
    },
  );
}
