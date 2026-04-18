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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillMetadata = {
  name: string;
  description: string;
  trigger: string | undefined;
  tools: string[] | undefined;
  args: string[] | undefined;
  /** Optional natural-language hint for when this skill applies; concatenated to description for trigger matching */
  whenToUse: string | undefined;
  /** SPDX license identifier (e.g. "MIT", "Apache-2.0", "CC-BY-SA-4.0"). Used by install gate. */
  license: string | undefined;
  /** Glob patterns scoping skill auto-surfacing to specific file paths */
  paths: string[] | undefined;
  /** Execution context: "default" runs in the current agent, "fork" spawns a sub-agent (Anthropic extension) */
  context: "default" | "fork" | undefined;
  /** When `context: fork`, the sub-agent type to spawn (must match an AgentRole id) */
  agent: string | undefined;
  content: string;
  filePath: string;
  source: "bundled" | "project" | "global" | "plugin";
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
// Claude Code ecosystem mirror paths (Anthropic convention)
const CC_PROJECT_SKILLS_DIR = join(".claude", "skills");
const CC_GLOBAL_SKILLS_DIR = join(homedir(), ".claude", "skills");
// Bundled skills shipped with the openharness package itself.
// At runtime this resolves to <package-root>/data/skills/ both in dev (src/) and prod (dist/).
const BUNDLED_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "skills");

/** Parse a frontmatter list value. Accepts `[a, b]` (YAML inline) or `a b c` (space-separated, Anthropic spec). */
function parseListValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // Strip surrounding quotes if present
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  return unquoted.split(/\s+/).filter(Boolean);
}

/** Parse YAML frontmatter from a skill markdown file. Accepts both OH camelCase and Anthropic kebab-case. */
function parseSkillFrontmatter(content: string): Partial<SkillMetadata> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1]!;
  const result: Partial<SkillMetadata> = {};

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) result.name = nameMatch[1]!.trim();

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) result.description = descMatch[1]!.trim();

  // trigger: OH-native field; when-to-use / whenToUse: Anthropic-style hint (also used as trigger fallback)
  const triggerMatch = frontmatter.match(/^trigger:\s*(.+)$/m);
  if (triggerMatch) result.trigger = triggerMatch[1]!.trim();
  const whenToUseMatch = frontmatter.match(/^(?:when-to-use|whenToUse):\s*(.+)$/m);
  if (whenToUseMatch) result.whenToUse = whenToUseMatch[1]!.trim();

  // tools / allowedTools / allowed-tools — array OR space-separated. Merge all forms found.
  const toolsCollected = new Set<string>();
  for (const re of [/^tools:\s*(.+)$/m, /^allowedTools:\s*(.+)$/m, /^allowed-tools:\s*(.+)$/m]) {
    const m = frontmatter.match(re);
    if (m) for (const t of parseListValue(m[1]!)) toolsCollected.add(t);
  }
  if (toolsCollected.size > 0) result.tools = [...toolsCollected];

  // args / argument-hint
  const argsMatch = frontmatter.match(/^(?:args|argument-hint):\s*(.+)$/m);
  if (argsMatch) result.args = parseListValue(argsMatch[1]!);

  // invokeModel: false OR disable-model-invocation: true → hidden from system prompt
  if (frontmatter.match(/^invokeModel:\s*false$/m) || frontmatter.match(/^disable-model-invocation:\s*true$/m)) {
    result.invokeModel = false;
  }

  // license: SPDX identifier (e.g. MIT, Apache-2.0)
  const licenseMatch = frontmatter.match(/^license:\s*(.+)$/m);
  if (licenseMatch) result.license = licenseMatch[1]!.trim().replace(/^["']|["']$/g, "");

  // paths: glob list — scopes auto-surfacing to matching files
  const pathsMatch = frontmatter.match(/^paths:\s*(.+)$/m);
  if (pathsMatch) result.paths = parseListValue(pathsMatch[1]!);

  // context: "default" | "fork" — when "fork", skill runs in a new sub-agent context
  const contextMatch = frontmatter.match(/^context:\s*(.+)$/m);
  if (contextMatch) {
    const v = contextMatch[1]!.trim().replace(/^["']|["']$/g, "");
    if (v === "fork" || v === "default") result.context = v;
  }

  // agent: sub-agent type name (only meaningful when context: fork)
  const agentMatch = frontmatter.match(/^agent:\s*(.+)$/m);
  if (agentMatch) result.agent = agentMatch[1]!.trim().replace(/^["']|["']$/g, "");

  return result;
}

/** Recursively collect skill .md files from a directory tree.
 * Anthropic / Claude Code convention: a directory containing `SKILL.md` is a single
 * directory-packaged skill — only the SKILL.md surfaces; sibling .md files are
 * companion documentation (referenced via Read at runtime). Directories without
 * SKILL.md fall through to the legacy flat-file behavior (every .md is a skill).
 */
function walkMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  // Directory-packaged skill: only SKILL.md counts; siblings are companions.
  if (entries.includes("SKILL.md")) {
    return [join(dir, "SKILL.md")];
  }

  const results: string[] = [];
  for (const entry of entries) {
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
          whenToUse: meta.whenToUse,
          license: meta.license,
          paths: meta.paths,
          context: meta.context,
          agent: meta.agent,
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

/** Discover all available skills from bundled + project + global dirs + installed plugins */
export function discoverSkills(): SkillMetadata[] {
  const skills: SkillMetadata[] = [];
  // Bundled (shipped with the openharness package)
  skills.push(...loadSkillsFromDir(BUNDLED_SKILLS_DIR, "bundled"));
  // OH-native paths
  skills.push(...loadSkillsFromDir(PROJECT_SKILLS_DIR, "project"));
  skills.push(...loadSkillsFromDir(GLOBAL_SKILLS_DIR, "global"));
  // Claude Code ecosystem mirror paths — same source labels (project/global)
  skills.push(...loadSkillsFromDir(CC_PROJECT_SKILLS_DIR, "project"));
  skills.push(...loadSkillsFromDir(CC_GLOBAL_SKILLS_DIR, "global"));

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

  // De-duplicate by name+filePath: if same skill appears in multiple paths (e.g. CC mirror), keep first.
  const seen = new Set<string>();
  return skills.filter((s) => {
    const key = `${s.name}::${s.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Find a skill by name (case-insensitive) */
export function findSkill(name: string): SkillMetadata | null {
  const skills = discoverSkills();
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Find skills that match a trigger condition (substring match against `trigger` field). */
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
