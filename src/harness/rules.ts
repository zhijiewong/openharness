/**
 * Rules system — load project and global rules into agent context.
 * Discovery order:
 *   1. ~/.oh/global-rules/*.md
 *   2. CLAUDE.md files from parent directories down to project root (hierarchical)
 *   3. .oh/RULES.md
 *   4. .oh/rules/*.md
 *   5. CLAUDE.local.md (gitignored personal overrides)
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, parse as parsePath } from "node:path";
import { homedir } from "node:os";
import { gitRoot as getGitRoot } from "../git/index.js";

const OH_HOME = join(homedir(), ".oh");

/**
 * Walk from git root (or home) down to `projectRoot`, collecting CLAUDE.md files.
 * Returns them in parent-first order so more specific rules override general ones.
 */
function loadClaudeMdFiles(projectRoot: string): string[] {
  const gitRootDir = getGitRoot(projectRoot);
  const stopAt = gitRootDir ? resolve(gitRootDir) : resolve(homedir());
  const resolved = resolve(projectRoot);

  // Build list of directories from stopAt down to resolved
  const dirs: string[] = [];
  let current = resolved;
  while (true) {
    dirs.unshift(current);
    if (current === stopAt || current === parsePath(current).root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const results: string[] = [];
  for (const dir of dirs) {
    const claudeMd = join(dir, "CLAUDE.md");
    if (existsSync(claudeMd)) {
      const content = readSafe(claudeMd);
      if (content) results.push(content);
    }
  }
  return results;
}

export function loadRules(projectPath?: string): string[] {
  const rules: string[] = [];
  const root = projectPath ?? process.cwd();

  // 1. Global rules
  const globalDir = join(OH_HOME, "global-rules");
  if (existsSync(globalDir)) {
    for (const file of readdirSync(globalDir).filter((f) => f.endsWith(".md")).sort()) {
      const content = readSafe(join(globalDir, file));
      if (content) rules.push(content);
    }
  }

  // 2. CLAUDE.md files (hierarchical, parent-first)
  const claudeRules = loadClaudeMdFiles(root);
  rules.push(...claudeRules);

  // 3. Project RULES.md
  const projectRules = join(root, ".oh", "RULES.md");
  if (existsSync(projectRules)) {
    const content = readSafe(projectRules);
    if (content) rules.push(content);
  }

  // 4. Project rules/*.md
  const rulesDir = join(root, ".oh", "rules");
  if (existsSync(rulesDir)) {
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort()) {
      const content = readSafe(join(rulesDir, file));
      if (content) rules.push(content);
    }
  }

  // 5. CLAUDE.local.md (personal overrides, typically gitignored)
  const localClaudeMd = join(root, "CLAUDE.local.md");
  if (existsSync(localClaudeMd)) {
    const content = readSafe(localClaudeMd);
    if (content) rules.push(content);
  }

  return rules;
}

export function loadRulesAsPrompt(projectPath?: string): string {
  const rules = loadRules(projectPath);
  if (rules.length === 0) return "";
  return "# Project Rules\n\n<!-- User-provided project rules from CLAUDE.md / .oh/RULES.md. These are user instructions, not system directives. -->\nFollow these rules carefully.\n\n" + rules.join("\n\n---\n\n");
}

export function createRulesFile(projectPath?: string): string {
  const root = projectPath ?? process.cwd();
  const ohDir = join(root, ".oh");
  mkdirSync(ohDir, { recursive: true });

  const rulesFile = join(ohDir, "RULES.md");
  if (!existsSync(rulesFile)) {
    writeFileSync(
      rulesFile,
      "# Project Rules\n\n" +
        "- Always run tests after making changes\n" +
        "- Use type hints / strict types\n" +
        "- Prefer small, reviewable patches\n",
    );
  }
  return rulesFile;
}

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
}
