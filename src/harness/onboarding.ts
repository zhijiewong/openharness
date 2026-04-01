/**
 * Project auto-detection — detect language, framework, test runner, git state.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

export type ProjectContext = {
  root: string;
  language: string;
  framework: string;
  packageManager: string;
  testRunner: string;
  hasGit: boolean;
  gitBranch: string;
  hasReadme: boolean;
  description: string;
};

const DETECTORS: Array<[string, string, string, string, string]> = [
  // [indicator, language, framework, packageManager, testRunner]
  ["pyproject.toml", "python", "", "pip", "pytest"],
  ["requirements.txt", "python", "", "pip", "pytest"],
  ["package.json", "javascript", "", "npm", "jest"],
  ["bun.lockb", "typescript", "", "bun", "bun test"],
  ["deno.json", "typescript", "", "deno", "deno test"],
  ["Cargo.toml", "rust", "", "cargo", "cargo test"],
  ["go.mod", "go", "", "go", "go test"],
  ["pom.xml", "java", "", "maven", "mvn test"],
  ["build.gradle", "java", "", "gradle", "gradle test"],
  ["Gemfile", "ruby", "", "bundler", "rspec"],
  ["composer.json", "php", "", "composer", "phpunit"],
  ["Package.swift", "swift", "", "swift", "swift test"],
];

const FRAMEWORKS: Record<string, string> = {
  "next.config.js": "Next.js",
  "next.config.ts": "Next.js",
  "nuxt.config.js": "Nuxt",
  "nuxt.config.ts": "Nuxt",
  "vite.config.ts": "Vite",
  "angular.json": "Angular",
  "svelte.config.js": "Svelte",
  "manage.py": "Django",
  "tailwind.config.js": "Tailwind CSS",
  "Dockerfile": "Docker",
  "docker-compose.yml": "Docker Compose",
};

export function detectProject(root?: string): ProjectContext {
  const projectRoot = root ?? process.cwd();
  let language = "unknown";
  let framework = "";
  let packageManager = "";
  let testRunner = "";

  for (const [indicator, lang, fw, pm, tr] of DETECTORS) {
    if (existsSync(join(projectRoot, indicator))) {
      language = lang;
      framework = fw || framework;
      packageManager = pm;
      testRunner = tr;
      break;
    }
  }

  for (const [file, fw] of Object.entries(FRAMEWORKS)) {
    if (existsSync(join(projectRoot, file))) {
      framework = fw;
      break;
    }
  }

  const hasGit = existsSync(join(projectRoot, ".git"));
  let gitBranch = "";
  if (hasGit) {
    try {
      const head = readFileSync(join(projectRoot, ".git", "HEAD"), "utf-8").trim();
      if (head.startsWith("ref: refs/heads/")) {
        gitBranch = head.slice("ref: refs/heads/".length);
      }
    } catch { /* ignore */ }
  }

  const hasReadme = ["README.md", "README.rst", "README.txt", "README"].some(
    (f) => existsSync(join(projectRoot, f)),
  );

  let description = "";
  for (const name of ["README.md", "README.rst", "README.txt"]) {
    const path = join(projectRoot, name);
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.replace(/^#+\s*/, "").trim();
        if (trimmed) { description = trimmed.slice(0, 200); break; }
      }
      break;
    }
  }

  return { root: projectRoot, language, framework, packageManager, testRunner, hasGit, gitBranch, hasReadme, description };
}

export function projectContextToPrompt(ctx: ProjectContext): string {
  const parts: string[] = [`Working directory: ${ctx.root}`];
  if (ctx.language !== "unknown") {
    parts.push(`Language: ${ctx.language}${ctx.framework ? ` (${ctx.framework})` : ""}`);
  }
  if (ctx.packageManager) parts.push(`Package manager: ${ctx.packageManager}`);
  if (ctx.testRunner) parts.push(`Test command: ${ctx.testRunner}`);
  if (ctx.hasGit) parts.push(`Git: yes${ctx.gitBranch ? ` (branch: ${ctx.gitBranch})` : ""}`);
  if (ctx.description) parts.push(`Project: ${ctx.description}`);
  return "# Environment\n" + parts.map((p) => `- ${p}`).join("\n");
}
