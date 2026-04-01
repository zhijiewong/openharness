/**
 * Rules system — load project and global rules into agent context.
 * Discovery order: ~/.oh/global-rules/*.md → .oh/RULES.md → .oh/rules/*.md
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const OH_HOME = join(homedir(), ".oh");

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

  // 2. Project RULES.md
  const projectRules = join(root, ".oh", "RULES.md");
  if (existsSync(projectRules)) {
    const content = readSafe(projectRules);
    if (content) rules.push(content);
  }

  // 3. Project rules/*.md
  const rulesDir = join(root, ".oh", "rules");
  if (existsSync(rulesDir)) {
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort()) {
      const content = readSafe(join(rulesDir, file));
      if (content) rules.push(content);
    }
  }

  return rules;
}

export function loadRulesAsPrompt(projectPath?: string): string {
  const rules = loadRules(projectPath);
  if (rules.length === 0) return "";
  return "# Project Rules\n\nFollow these rules carefully.\n\n" + rules.join("\n\n---\n\n");
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
