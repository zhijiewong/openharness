/**
 * Project auto-detection — detect language, framework, test runner, git state.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { platform, release, hostname } from "node:os";

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

export function projectContextToPrompt(ctx: ProjectContext, model?: string): string {
  const parts: string[] = [];

  // Working directory
  parts.push(`Primary working directory: ${ctx.root}`);
  parts.push(`Is a git repository: ${ctx.hasGit}`);

  // Platform info
  const plat = platform();
  const shell = plat === "win32" ? "cmd.exe" : (process.env.SHELL ?? "/bin/bash");
  parts.push(`Platform: ${plat}`);
  parts.push(`Shell: ${shell}`);
  parts.push(`OS Version: ${release()}`);

  // Current date
  const now = new Date();
  parts.push(`Current date: ${now.toISOString().split("T")[0]}`);

  // Model
  if (model) parts.push(`Model: ${model}`);

  // Project info
  if (ctx.language !== "unknown") {
    parts.push(`Language: ${ctx.language}${ctx.framework ? ` (${ctx.framework})` : ""}`);
  }
  if (ctx.packageManager) parts.push(`Package manager: ${ctx.packageManager}`);
  if (ctx.testRunner) parts.push(`Test command: ${ctx.testRunner}`);
  if (ctx.description) parts.push(`Project: ${ctx.description}`);

  // Git status snapshot
  if (ctx.hasGit) {
    if (ctx.gitBranch) parts.push(`Current branch: ${ctx.gitBranch}`);

    // Main/default branch detection
    let mainBranch = "main";
    try {
      const refs = execSync("git branch -l main master", { cwd: ctx.root, stdio: "pipe" }).toString().trim();
      if (refs.includes("main")) mainBranch = "main";
      else if (refs.includes("master")) mainBranch = "master";
    } catch { /* ignore */ }
    parts.push(`Main branch: ${mainBranch}`);

    // Git user
    try {
      const user = execSync("git config user.name", { cwd: ctx.root, stdio: "pipe" }).toString().trim();
      if (user) parts.push(`Git user: ${user}`);
    } catch { /* ignore */ }

    // Git status (brief)
    try {
      const status = execSync("git status --porcelain", { cwd: ctx.root, stdio: "pipe" }).toString().trim();
      if (status) {
        const lines = status.split("\n").slice(0, 20);
        parts.push(`\nStatus:\n${lines.join("\n")}${status.split("\n").length > 20 ? "\n..." : ""}`);
      }
    } catch { /* ignore */ }

    // Recent commits
    try {
      const log = execSync("git log --oneline -5", { cwd: ctx.root, stdio: "pipe" }).toString().trim();
      if (log) parts.push(`\nRecent commits:\n${log}`);
    } catch { /* ignore */ }
  }

  return "# Environment\n" + parts.map((p) => `- ${p}`).join("\n");
}
