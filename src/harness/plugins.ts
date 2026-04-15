/**
 * Plugin system — discover and load skills, plugins, and agent teams.
 *
 * Skills: Markdown files with YAML frontmatter defining trigger conditions and tool whitelists.
 * Plugins: Bundles of skills + hooks + MCP server configs.
 * Agent Teams: Named agent configurations for specific roles.
 *
 * Search order for skills:
 * 1. .oh/skills/ (project-level)
 * 2. ~/.oh/skills/ (global)
 * 3. node_modules packages with "openharness-plugin" keyword
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export type SkillMetadata = {
  name: string;
  description: string;
  trigger: string | undefined;
  tools: string[] | undefined;
  args: string[] | undefined;
  content: string;
  filePath: string;
  source: "project" | "global" | "plugin";
  /** When false, skill is hidden from system prompt until explicitly invoked */
  invokeModel: boolean;
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  skills?: string[]; // skill file paths relative to plugin dir
  hooks?: Record<string, string>; // event → command
  mcpServers?: Array<{ name: string; command: string; args?: string[] }>;
  agentTeams?: AgentTeamConfig[];
};

export type AgentTeamConfig = {
  name: string;
  description: string;
  roles: Array<{
    name: string;
    systemPrompt: string;
    tools?: string[]; // tool whitelist for this role
  }>;
};

const PROJECT_SKILLS_DIR = join(".oh", "skills");
const GLOBAL_SKILLS_DIR = join(homedir(), ".oh", "skills");

/** Parse YAML frontmatter from a skill markdown file */
function parseSkillFrontmatter(content: string): Partial<SkillMetadata> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1]!;
  const result: Partial<SkillMetadata> = {};

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) result.name = nameMatch[1]!.trim();

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) result.description = descMatch[1]!.trim();

  const triggerMatch = frontmatter.match(/^trigger:\s*(.+)$/m);
  if (triggerMatch) result.trigger = triggerMatch[1]!.trim();

  const toolsMatch = frontmatter.match(/^tools:\s*\[(.+)\]$/m);
  if (toolsMatch) result.tools = toolsMatch[1]!.split(",").map((t) => t.trim());

  // Also parse allowedTools (used by built-in skills) and merge with tools
  const allowedToolsMatch = frontmatter.match(/^allowedTools:\s*\[(.+)\]$/m);
  if (allowedToolsMatch) {
    const allowed = allowedToolsMatch[1]!.split(",").map((t) => t.trim());
    result.tools = result.tools ? [...new Set([...result.tools, ...allowed])] : allowed;
  }

  const argsMatch = frontmatter.match(/^args:\s*\[(.+)\]$/m);
  if (argsMatch) result.args = argsMatch[1]!.split(",").map((a) => a.trim());

  // invokeModel: false OR disable-model-invocation: true → hidden from system prompt
  if (frontmatter.match(/^invokeModel:\s*false$/m) || frontmatter.match(/^disable-model-invocation:\s*true$/m)) {
    result.invokeModel = false;
  }

  return result;
}

/** Recursively collect all .md files from a directory tree */
function walkMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...walkMdFiles(full));
      } else if (entry.endsWith(".md")) {
        results.push(full);
      }
    } catch {
      /* skip unreadable */
    }
  }
  return results;
}

/** Load skills from a directory (recursively walks subdirectories) */
function loadSkillsFromDir(dir: string, source: SkillMetadata["source"]): SkillMetadata[] {
  const files = walkMdFiles(dir);
  return files
    .map((filePath) => {
      try {
        const content = readFileSync(filePath, "utf-8");
        const meta = parseSkillFrontmatter(content);
        // Derive name from relative path if not in frontmatter
        const relName = relative(dir, filePath).replace(/\.md$/, "").replace(/\\/g, "/");
        return {
          name: meta.name || relName,
          description: meta.description || "",
          trigger: meta.trigger,
          tools: meta.tools,
          args: meta.args,
          content,
          filePath,
          source,
          invokeModel: meta.invokeModel ?? true,
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is SkillMetadata => s !== null);
}

/** Discover all available skills from project + global dirs + installed plugins */
export function discoverSkills(): SkillMetadata[] {
  const skills: SkillMetadata[] = [];
  skills.push(...loadSkillsFromDir(PROJECT_SKILLS_DIR, "project"));
  skills.push(...loadSkillsFromDir(GLOBAL_SKILLS_DIR, "global"));

  // Load skills from installed marketplace plugins (namespaced as plugin-name:skill-name)
  try {
    const { getInstalledPlugins } = require("./marketplace.js") as typeof import("./marketplace.js");
    for (const plugin of getInstalledPlugins()) {
      const pluginSkillsDir = join(plugin.cachePath, "skills");
      const pluginSkills = loadSkillsFromDir(pluginSkillsDir, "plugin");
      // Namespace: prefix skill name with plugin name
      for (const skill of pluginSkills) {
        skill.name = `${plugin.name}:${skill.name}`;
      }
      skills.push(...pluginSkills);
    }
  } catch {
    /* marketplace module may not be loaded yet */
  }

  return skills;
}

/** Find a skill by name (case-insensitive) */
export function findSkill(name: string): SkillMetadata | null {
  const skills = discoverSkills();
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Find skills that match a trigger condition */
export function findTriggeredSkills(userMessage: string): SkillMetadata[] {
  const skills = discoverSkills();
  return skills.filter((s) => {
    if (!s.trigger) return false;
    return userMessage.toLowerCase().includes(s.trigger.toLowerCase());
  });
}

/** Find a skill similar to a candidate (for patch-vs-create decision) */
export function findSimilarSkill(
  candidateName: string,
  candidateDescription: string,
  skills: Array<{ name: string; description: string }>,
): { name: string; description: string } | null {
  const nameWords = new Set(candidateName.toLowerCase().split(/[-_ ]+/));
  for (const skill of skills) {
    const skillWords = new Set(skill.name.toLowerCase().split(/[-_ ]+/));
    const overlap = [...nameWords].filter((w) => skillWords.has(w)).length;
    if (overlap >= Math.ceil(nameWords.size * 0.5)) return skill;
    const descWords = new Set(skill.description.toLowerCase().split(/\s+/));
    const descOverlap = candidateDescription
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => descWords.has(w)).length;
    if (descOverlap >= 3) return skill;
  }
  return null;
}

/** Load a plugin manifest from a directory */
export function loadPluginManifest(dir: string): PluginManifest | null {
  const manifestPath = join(dir, "openharness-plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
  } catch {
    return null;
  }
}

/** Discover plugins from node_modules */
export function discoverPlugins(): PluginManifest[] {
  const plugins: PluginManifest[] = [];

  // Check node_modules for packages with openharness-plugin.json
  const nodeModules = join(".", "node_modules");
  if (!existsSync(nodeModules)) return plugins;

  try {
    for (const pkg of readdirSync(nodeModules)) {
      if (pkg.startsWith(".")) continue;
      const pkgDir = join(nodeModules, pkg);
      const manifest = loadPluginManifest(pkgDir);
      if (manifest) plugins.push(manifest);

      // Scoped packages
      if (pkg.startsWith("@")) {
        try {
          for (const sub of readdirSync(pkgDir)) {
            const subDir = join(pkgDir, sub);
            const subManifest = loadPluginManifest(subDir);
            if (subManifest) plugins.push(subManifest);
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return plugins;
}

/** Build a prompt listing available skills for the LLM */
export function skillsToPrompt(skills: SkillMetadata[]): string {
  // Only include skills with invokeModel !== false (hidden skills excluded from prompt)
  const visible = skills.filter((s) => s.invokeModel !== false);
  if (visible.length === 0) return "";
  const lines = visible.map(
    (s) => `- ${s.name}: ${s.description}${s.trigger ? ` (auto-trigger: "${s.trigger}")` : ""}`,
  );
  return `# Available Skills\nUse the Skill tool to invoke these:\n${lines.join("\n")}`;
}
