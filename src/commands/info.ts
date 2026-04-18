/**
 * Info commands — /help, /cost, /status, /config, /files, /model, /memory, /doctor, /context, /mcp, /mcp-registry, /init
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gitBranch, isGitRepo, isInMergeOrRebase } from "../git/index.js";
import { readOhConfig } from "../harness/config.js";
import { estimateMessageTokens } from "../harness/context-warning.js";
import { getContextWindow } from "../harness/cost.js";
import { connectedMcpServers } from "../mcp/loader.js";
import { mcpLoginHandler, mcpLogoutHandler } from "./mcp-auth.js";
import type { CommandHandler } from "./types.js";

export function registerInfoCommands(
  register: (name: string, description: string, handler: CommandHandler) => void,
  getCommandMap: () => Map<string, { description: string }>,
) {
  register("help", "Show available commands", () => {
    const categories: Record<string, string[]> = {
      Session: [
        "clear",
        "compact",
        "export",
        "history",
        "browse",
        "resume",
        "fork",
        "pin",
        "unpin",
        "add-dir",
        "listen",
        "truncate",
        "search",
      ],
      Git: ["diff", "undo", "rewind", "commit", "log", "review-pr", "pr-comments", "release-notes", "stash", "branch"],
      Info: [
        "help",
        "cost",
        "status",
        "config",
        "files",
        "model",
        "memory",
        "doctor",
        "context",
        "mcp",
        "mcp-registry",
        "init",
        "bug",
        "feedback",
        "upgrade",
        "token-count",
        "benchmark",
        "version",
        "api-credits",
        "whoami",
        "project",
        "stats",
        "tools",
      ],
      Settings: [
        "theme",
        "vim",
        "companion",
        "fast",
        "keys",
        "effort",
        "sandbox",
        "permissions",
        "allowed-tools",
        "login",
        "logout",
        "terminal-setup",
        "verbose",
        "quiet",
        "provider",
      ],
      AI: ["plan", "review", "roles", "agents", "plugins", "btw", "loop", "summarize", "explain", "fix"],
      Pet: ["cybergotchi"],
    };
    const commands = getCommandMap();
    const lines: string[] = [];
    for (const [category, names] of Object.entries(categories)) {
      lines.push(`${category}:`);
      for (const name of names) {
        const cmd = commands.get(name);
        if (cmd) lines.push(`  /${name.padEnd(12)} ${cmd.description}`);
      }
      lines.push("");
    }
    const categorized = new Set(Object.values(categories).flat());
    const uncategorized = [...commands.keys()].filter((n) => !categorized.has(n));
    if (uncategorized.length > 0) {
      lines.push("Other:");
      for (const name of uncategorized) {
        const cmd = commands.get(name)!;
        lines.push(`  /${name.padEnd(12)} ${cmd.description}`);
      }
    }
    return { output: lines.join("\n"), handled: true };
  });

  register("cost", "Show session cost and token usage", (_args, ctx) => {
    const lines = [
      `Cost:    $${ctx.totalCost.toFixed(4)}`,
      `Tokens:  ${ctx.totalInputTokens.toLocaleString()} input, ${ctx.totalOutputTokens.toLocaleString()} output`,
      `Model:   ${ctx.model}`,
      `Session: ${ctx.sessionId}`,
    ];
    return { output: lines.join("\n"), handled: true };
  });

  register("status", "Show session status", (_args, ctx) => {
    const lines = [
      `Model:      ${ctx.model}`,
      `Mode:       ${ctx.permissionMode}`,
      `Messages:   ${ctx.messages.length}`,
      `Cost:       $${ctx.totalCost.toFixed(4)}`,
      `Session:    ${ctx.sessionId}`,
    ];
    if (isGitRepo()) {
      lines.push(`Git branch: ${gitBranch()}`);
    }
    const mcp = connectedMcpServers();
    if (mcp.length > 0) {
      lines.push(`MCP servers: ${mcp.join(", ")}`);
    }
    return { output: lines.join("\n"), handled: true };
  });

  register("config", "Show current configuration", (_args, ctx) => {
    const saved = readOhConfig();
    const lines: string[] = ["Configuration:"];
    if (saved) {
      lines.push(`  Provider:    ${saved.provider}`);
      lines.push(`  Model:       ${saved.model}`);
      lines.push(`  Permission:  ${saved.permissionMode}`);
      if (saved.baseUrl) lines.push(`  Base URL:    ${saved.baseUrl}`);
      if (saved.apiKey) lines.push(`  API key:     ${"*".repeat(8)}...`);
      lines.push(`  Source:      .oh/config.yaml`);
    } else {
      lines.push(`  No .oh/config.yaml found — run oh init to create one`);
    }
    lines.push("");
    lines.push(`  Active model:      ${ctx.model}`);
    lines.push(`  Permission mode:   ${ctx.permissionMode}`);
    const mcp = connectedMcpServers();
    if (mcp.length > 0) lines.push(`  MCP servers:       ${mcp.join(", ")}`);
    return { output: lines.join("\n"), handled: true };
  });

  register("files", "List files in context", (_args, ctx) => {
    const files = new Set<string>();
    for (const msg of ctx.messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const path = tc.arguments?.file_path ?? tc.arguments?.path;
          if (path) files.add(String(path));
        }
      }
    }
    if (files.size === 0) return { output: "No files in context yet.", handled: true };
    return { output: `Files in context:\n${[...files].map((f) => `  ${f}`).join("\n")}`, handled: true };
  });

  register("model", "Switch model (e.g., /model llama3.2 or /model ollama/llama3.2)", (args, ctx) => {
    const model = args.trim();
    if (!model)
      return { output: "Usage: /model <model-name>  (prefix with provider/ to switch providers)", handled: true };

    let newProviderName: string;
    if (model.includes("/")) {
      newProviderName = model.split("/")[0]!;
    } else {
      newProviderName = ctx.providerName;
    }

    if (newProviderName !== ctx.providerName) {
      return {
        output: `Cannot switch to '${model}': requires the '${newProviderName}' provider but current session uses '${ctx.providerName}'.\nRestart with: oh --model ${newProviderName}/${model.includes("/") ? model.split("/").slice(1).join("/") : model}`,
        handled: true,
      };
    }

    const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
    return { output: `Switched to ${modelName}.`, handled: true, newModel: modelName };
  });

  register("memory", "View and search memories in .oh/memory/", (args) => {
    const memDir = join(process.cwd(), ".oh", "memory");
    if (!existsSync(memDir)) {
      return { output: "No .oh/memory/ directory found. Memories are stored there by the AI.", handled: true };
    }

    const term = args.trim().toLowerCase();
    let files: string[];
    try {
      files = readdirSync(memDir).filter((f) => f.endsWith(".md"));
    } catch {
      return { output: "Could not read .oh/memory/", handled: true };
    }
    if (files.length === 0) return { output: "No memories stored yet.", handled: true };

    if (term) {
      const matches: string[] = [];
      for (const file of files) {
        try {
          const content = readFileSync(join(memDir, file), "utf-8");
          if (content.toLowerCase().includes(term)) {
            const firstLine = content.split("\n").find((l) => l.trim() && !l.startsWith("---")) ?? file;
            matches.push(`  ${file.padEnd(30)} ${firstLine.slice(0, 50)}`);
          }
        } catch {
          /* skip */
        }
      }
      if (matches.length === 0) return { output: `No memories matching "${term}".`, handled: true };
      return { output: `Memories matching "${term}":\n${matches.join("\n")}`, handled: true };
    }

    const lines = [`Memories (${files.length})  — use /memory <term> to search:\n`];
    for (const file of files) {
      try {
        const content = readFileSync(join(memDir, file), "utf-8");
        const nameLine = content.match(/^name:\s*(.+)$/m)?.[1] ?? file.replace(".md", "");
        const typeLine = content.match(/^type:\s*(.+)$/m)?.[1] ?? "?";
        const descLine = content.match(/^description:\s*(.+)$/m)?.[1] ?? "";
        lines.push(`  [${typeLine.padEnd(8)}] ${nameLine.padEnd(24)} ${descLine.slice(0, 40)}`);
      } catch {
        lines.push(`  ${file}`);
      }
    }
    return { output: lines.join("\n"), handled: true };
  });

  register("doctor", "Run diagnostic health checks", (_args, ctx) => {
    const lines: string[] = [];
    const issues: string[] = [];

    lines.push("─── Health Check ───");
    lines.push("");

    lines.push(`  Provider:      ${ctx.providerName || "⚠ not set"}`);
    lines.push(`  Model:         ${ctx.model || "⚠ not set"}`);
    lines.push(`  Permission:    ${ctx.permissionMode}`);
    if (!ctx.model) issues.push("No model configured. Use --model or set in .oh/config.yaml");

    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    if (ctx.providerName === "anthropic" && !hasAnthropicKey) {
      issues.push("ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=sk-...");
    }
    if (ctx.providerName === "openai" && !hasOpenAIKey) {
      issues.push("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=sk-...");
    }
    if (ctx.providerName === "ollama") {
      lines.push(`  Ollama:        configured (ensure 'ollama serve' is running)`);
    }

    const ctxWindow = getContextWindow(ctx.model);
    const totalTokens = estimateMessageTokens(ctx.messages);
    const usage = ctxWindow > 0 ? Math.round((totalTokens / ctxWindow) * 100) : 0;
    lines.push(`  Context:       ~${totalTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} tokens (${usage}%)`);
    if (usage > 80) issues.push(`Context ${usage}% full. Consider /compact to free space.`);

    lines.push("");
    if (isGitRepo()) {
      lines.push(`  Git:           ✓ (branch: ${gitBranch()})`);
      if (isInMergeOrRebase()) {
        lines.push(`  ⚠ Merge/rebase in progress`);
        issues.push("Git merge/rebase in progress. Resolve before making changes.");
      }
    } else {
      lines.push(`  Git:           ✗ (not a git repo)`);
    }

    const mcp = connectedMcpServers();
    lines.push(`  MCP servers:   ${mcp.length > 0 ? mcp.join(", ") : "none"}`);

    const cfg = readOhConfig();
    lines.push(`  Config:        ${cfg ? ".oh/config.yaml ✓" : "not found"}`);

    lines.push("");
    lines.push(`  Session:       ${ctx.sessionId}`);
    lines.push(`  Messages:      ${ctx.messages.length}`);
    lines.push(`  Cost:          $${ctx.totalCost.toFixed(4)}`);

    try {
      const ohDir = join(homedir(), ".oh");
      if (existsSync(ohDir)) {
        const sessionsDir = join(ohDir, "sessions");
        const sessCount = existsSync(sessionsDir)
          ? readdirSync(sessionsDir).filter((f) => f.endsWith(".json")).length
          : 0;
        lines.push(`  Sessions:      ${sessCount} saved`);
        if (sessCount > 80) issues.push(`${sessCount} saved sessions. Consider cleaning old ones.`);

        const memDir = join(ohDir, "memory");
        const memCount = existsSync(memDir) ? readdirSync(memDir).filter((f) => f.endsWith(".md")).length : 0;
        lines.push(`  Memories:      ${memCount} global`);

        const cronDir = join(ohDir, "crons");
        const cronCount = existsSync(cronDir) ? readdirSync(cronDir).filter((f) => f.endsWith(".json")).length : 0;
        lines.push(`  Cron tasks:    ${cronCount}`);
      }
    } catch {
      /* ignore */
    }

    try {
      const projMemDir = join(".oh", "memory");
      const projMemCount = existsSync(projMemDir) ? readdirSync(projMemDir).filter((f) => f.endsWith(".md")).length : 0;
      if (projMemCount > 0) lines.push(`  Project mems:  ${projMemCount}`);

      const skillsDir = join(".oh", "skills");
      const skillCount = existsSync(skillsDir) ? readdirSync(skillsDir).filter((f) => f.endsWith(".md")).length : 0;
      if (skillCount > 0) lines.push(`  Skills:        ${skillCount}`);
    } catch {
      /* ignore */
    }

    const globalCfg = existsSync(join(homedir(), ".oh", "config.yaml"));
    lines.push(`  Global config: ${globalCfg ? "~/.oh/config.yaml ✓" : "not set (optional)"}`);

    try {
      const { getVerificationConfig } = require("../harness/verification.js");
      const vCfg = getVerificationConfig();
      if (vCfg?.enabled) {
        lines.push(`  Verification:  ✓ (${vCfg.rules.length} rules, mode: ${vCfg.mode})`);
      } else {
        lines.push(`  Verification:  off (no rules detected)`);
      }
    } catch {
      /* ignore */
    }

    lines.push("");
    lines.push(`  Tools:         ${ctx.messages.length > 0 ? "ready" : "loaded"}`);

    lines.push(`  Node.js:       ${process.version}`);
    const [major] = process.version.slice(1).split(".").map(Number);
    if (major && major < 18) issues.push(`Node.js ${process.version} is below minimum (18+). Upgrade Node.js.`);

    if (issues.length > 0) {
      lines.push("");
      lines.push("─── Issues Found ───");
      for (const issue of issues) {
        lines.push(`  ⚠ ${issue}`);
      }
    } else {
      lines.push("");
      lines.push("  ✓ No issues found");
    }

    return { output: lines.join("\n"), handled: true };
  });

  register("context", "Show context window usage breakdown", (_args, ctx) => {
    const ctxWindow = getContextWindow(ctx.model);

    let userTokens = 0,
      assistantTokens = 0,
      toolTokens = 0,
      systemTokens = 0;
    for (const msg of ctx.messages) {
      const tokens = Math.ceil((msg.content?.length ?? 0) / 4);
      switch (msg.role) {
        case "user":
          userTokens += tokens;
          break;
        case "assistant":
          assistantTokens += tokens;
          break;
        case "tool":
          toolTokens += tokens;
          break;
        case "system":
          systemTokens += tokens;
          break;
      }
    }
    const totalTokens = userTokens + assistantTokens + toolTokens + systemTokens;
    const freeTokens = ctxWindow - totalTokens;
    const usage = totalTokens / ctxWindow;

    const barWidth = 30;
    const filled = Math.round(usage * barWidth);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);

    const pct = (n: number) => `${((n / ctxWindow) * 100).toFixed(1)}%`;
    const pad = (s: string, n: number) => s.padEnd(n);

    const lines = [
      `Context Window (${ctxWindow.toLocaleString()} tokens):`,
      "",
      `  ${pad("User messages:", 20)} ${userTokens.toLocaleString().padStart(8)} tokens  (${pct(userTokens)})`,
      `  ${pad("Assistant:", 20)} ${assistantTokens.toLocaleString().padStart(8)} tokens  (${pct(assistantTokens)})`,
      `  ${pad("Tool results:", 20)} ${toolTokens.toLocaleString().padStart(8)} tokens  (${pct(toolTokens)})`,
      `  ${pad("System/info:", 20)} ${systemTokens.toLocaleString().padStart(8)} tokens  (${pct(systemTokens)})`,
      "",
      `  ${pad("Total used:", 20)} ${totalTokens.toLocaleString().padStart(8)} tokens  (${pct(totalTokens)})`,
      `  ${pad("Free:", 20)} ${freeTokens.toLocaleString().padStart(8)} tokens  (${pct(freeTokens)})`,
      "",
      `  ${bar}  ${Math.round(usage * 100)}%`,
      "",
      `  Messages: ${ctx.messages.length}  |  Compress at: ${Math.round(ctxWindow * 0.8).toLocaleString()} (80%)`,
    ];

    return { output: lines.join("\n"), handled: true };
  });

  register("mcp", "Show MCP server status", () => {
    const mcp = connectedMcpServers();
    if (mcp.length === 0) {
      return {
        output:
          "No MCP servers connected.\nConfigure in .oh/config.yaml under mcpServers.\nRun /mcp-registry to browse available servers.",
        handled: true,
      };
    }
    const lines = [`MCP Servers (${mcp.length} connected):\n`];
    for (const name of mcp) {
      lines.push(`  ✓ ${name}`);
    }
    lines.push("\nRun /mcp-registry to browse and add more servers.");
    return { output: lines.join("\n"), handled: true };
  });

  register("mcp-registry", "Browse and add MCP servers from the curated registry", (args) => {
    const { searchRegistry, formatRegistry, generateConfigBlock, MCP_REGISTRY } = require("../mcp/registry.js");
    const query = args.trim();

    if (!query) {
      const output = `MCP Server Registry (${MCP_REGISTRY.length} servers)\n${"─".repeat(50)}\n\n${formatRegistry()}\n\nUsage:\n  /mcp-registry <name>    Show install config for a server\n  /mcp-registry <keyword> Search by name, description, or category`;
      return { output, handled: true };
    }

    const results = searchRegistry(query);
    if (results.length === 0) {
      return { output: `No MCP servers found matching "${query}".`, handled: true };
    }

    if (results.length === 1) {
      const entry = results[0]!;
      const config = generateConfigBlock(entry);
      const envNote = entry.envVars?.length
        ? `\n\nRequired environment variables:\n${entry.envVars.map((v: string) => `  - ${v}`).join("\n")}`
        : "";
      return {
        output: `${entry.name} — ${entry.description}\nPackage: ${entry.package}\nRisk: ${entry.riskLevel ?? "medium"}${envNote}\n\nAdd to .oh/config.yaml under mcpServers:\n\n${config}`,
        handled: true,
      };
    }

    return { output: `Found ${results.length} servers:\n\n${formatRegistry(results)}`, handled: true };
  });

  register("mcp-login", "Authenticate to a remote MCP server via OAuth", async (args) => {
    return mcpLoginHandler(args);
  });

  register("mcp-logout", "Wipe local OAuth tokens for an MCP server", async (args) => {
    return mcpLogoutHandler(args);
  });

  register("init", "Initialize project with .oh/ config", () => {
    const ohDir = join(process.cwd(), ".oh");
    if (existsSync(ohDir)) {
      return { output: ".oh/ directory already exists. Project is already initialized.", handled: true };
    }

    mkdirSync(ohDir, { recursive: true });

    const rulesPath = join(ohDir, "RULES.md");
    if (!existsSync(rulesPath)) {
      writeFileSync(
        rulesPath,
        `# Project Rules

<!-- Add project-specific instructions here. These are loaded into every session. -->
<!-- Examples: coding conventions, testing requirements, deployment guidelines. -->
`,
      );
    }

    const configPath = join(ohDir, "config.yaml");
    if (!existsSync(configPath)) {
      writeFileSync(
        configPath,
        `# OpenHarness project config
# provider: ollama
# model: llama3
# permissionMode: ask
`,
      );
    }

    return {
      output: `Initialized .oh/ with:\n  .oh/RULES.md — project rules\n  .oh/config.yaml — project config\n\nEdit these files to customize your project.`,
      handled: true,
    };
  });

  register("bug", "Report a bug or issue", () => {
    return {
      output:
        "Report issues at: https://github.com/zhijiewong/openharness/issues\n\nInclude:\n  - OpenHarness version (oh --version)\n  - Steps to reproduce\n  - Expected vs actual behavior\n  - OS and Node.js version",
      handled: true,
    };
  });

  register("feedback", "Send feedback or feature request", () => {
    return {
      output:
        "Share feedback at: https://github.com/zhijiewong/openharness/issues\n\nUse the 'enhancement' label for feature requests.\nUse the 'bug' label for bug reports.",
      handled: true,
    };
  });

  register("upgrade", "Check for updates", () => {
    let current = "unknown";
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        current = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? current;
      }
    } catch {
      /* ignore */
    }
    return {
      output: `Current version: v${current}\n\nTo upgrade:\n  npm update -g @zhijiewang/openharness\n\nOr check: https://github.com/zhijiewong/openharness/releases`,
      handled: true,
    };
  });

  register("token-count", "Count tokens in a message or file", (args, ctx) => {
    const text = args.trim();
    if (!text) {
      const total = estimateMessageTokens(ctx.messages);
      return { output: `Conversation tokens: ~${total.toLocaleString()} (estimated)`, handled: true };
    }
    if (existsSync(text)) {
      try {
        const content = readFileSync(text, "utf-8");
        const tokens = Math.ceil(content.length / 4);
        return {
          output: `File: ${text}\nCharacters: ${content.length.toLocaleString()}\nEstimated tokens: ~${tokens.toLocaleString()}`,
          handled: true,
        };
      } catch {
        return { output: `Could not read file: ${text}`, handled: true };
      }
    }
    const tokens = Math.ceil(text.length / 4);
    return { output: `Text: ${text.length} chars → ~${tokens} tokens (estimated)`, handled: true };
  });

  register("version", "Show version number", () => {
    let version = "unknown";
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        version = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? version;
      }
    } catch {
      /* ignore */
    }
    return { output: `openHarness v${version}`, handled: true };
  });

  register("api-credits", "Check API credit balance", (_args, ctx) => {
    const envHint =
      ctx.providerName === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : ctx.providerName === "openai"
          ? "OPENAI_API_KEY"
          : `${ctx.providerName.toUpperCase()}_API_KEY`;
    const lines = [
      "API credit balance is not available via local CLI.",
      "",
      `Provider: ${ctx.providerName}`,
      `Check your balance at your provider's dashboard.`,
      "",
      `Tip: Ensure ${envHint} is set in your environment.`,
      `Session cost so far: $${ctx.totalCost.toFixed(4)}`,
    ];
    return { output: lines.join("\n"), handled: true };
  });

  register("whoami", "Show current user and provider info", (_args, ctx) => {
    const lines = [
      `Provider:   ${ctx.providerName}`,
      `Model:      ${ctx.model}`,
      `Permission: ${ctx.permissionMode}`,
      `Session:    ${ctx.sessionId}`,
      `Node.js:    ${process.version}`,
      `CWD:        ${process.cwd()}`,
    ];
    return { output: lines.join("\n"), handled: true };
  });

  register("project", "Show detected project info", () => {
    const cwd = process.cwd();
    const pkgPath = join(cwd, "package.json");
    const lines: string[] = [`Project directory: ${cwd}`];

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        lines.push(`  Name:        ${pkg.name ?? "unknown"}`);
        lines.push(`  Version:     ${pkg.version ?? "unknown"}`);
        lines.push(`  Description: ${pkg.description ?? "none"}`);
        if (pkg.type) lines.push(`  Type:        ${pkg.type}`);
        const deps = Object.keys(pkg.dependencies ?? {}).length;
        const devDeps = Object.keys(pkg.devDependencies ?? {}).length;
        lines.push(`  Dependencies: ${deps} prod, ${devDeps} dev`);

        // Detect framework
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworks: string[] = [];
        if (allDeps.react) frameworks.push("React");
        if (allDeps.next) frameworks.push("Next.js");
        if (allDeps.vue) frameworks.push("Vue");
        if (allDeps.express) frameworks.push("Express");
        if (allDeps.fastify) frameworks.push("Fastify");
        if (allDeps.typescript) frameworks.push("TypeScript");
        if (frameworks.length > 0) lines.push(`  Detected:    ${frameworks.join(", ")}`);
      } catch {
        lines.push("  Could not parse package.json");
      }
    } else {
      lines.push("  No package.json found");
    }

    if (isGitRepo()) {
      lines.push(`  Git branch:  ${gitBranch()}`);
    }

    return { output: lines.join("\n"), handled: true };
  });

  register("stats", "Show session statistics", (_args, ctx) => {
    let userMsgs = 0,
      assistantMsgs = 0,
      toolMsgs = 0,
      systemMsgs = 0;
    let toolCalls = 0;
    for (const msg of ctx.messages) {
      switch (msg.role) {
        case "user":
          userMsgs++;
          break;
        case "assistant":
          assistantMsgs++;
          break;
        case "tool":
          toolMsgs++;
          break;
        case "system":
          systemMsgs++;
          break;
      }
      if (msg.toolCalls) toolCalls += msg.toolCalls.length;
    }

    const lines = [
      "Session Statistics:",
      "",
      `  Messages:       ${ctx.messages.length} total`,
      `    User:         ${userMsgs}`,
      `    Assistant:    ${assistantMsgs}`,
      `    Tool:         ${toolMsgs}`,
      `    System:       ${systemMsgs}`,
      "",
      `  Tool calls:     ${toolCalls}`,
      "",
      `  Input tokens:   ${ctx.totalInputTokens.toLocaleString()}`,
      `  Output tokens:  ${ctx.totalOutputTokens.toLocaleString()}`,
      `  Total cost:     $${ctx.totalCost.toFixed(4)}`,
      "",
      `  Model:          ${ctx.model}`,
      `  Session ID:     ${ctx.sessionId}`,
    ];
    return { output: lines.join("\n"), handled: true };
  });

  register("tools", "List available tools", (_args, ctx) => {
    const toolNames = new Set<string>();
    for (const msg of ctx.messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.toolName) toolNames.add(tc.toolName);
        }
      }
    }

    const mcp = connectedMcpServers();
    const lines = ["Available Tools:"];
    lines.push("");
    lines.push("  Built-in: Read, Write, Edit, Bash, Glob, Grep, Agent");
    if (mcp.length > 0) {
      lines.push(`  MCP:      ${mcp.join(", ")}`);
    }
    if (toolNames.size > 0) {
      lines.push("");
      lines.push(`  Used this session: ${[...toolNames].join(", ")}`);
    }
    return { output: lines.join("\n"), handled: true };
  });

  register("benchmark", "Run SWE-bench benchmark suite", (args) => {
    const task = args.trim();
    if (!task) {
      return {
        output:
          "Usage: /benchmark <task-id or 'list'>\n\nExamples:\n  /benchmark list              List available tasks\n  /benchmark django__django-1234  Run a specific task\n\nSee BENCHMARKS.md for results and methodology.",
        handled: true,
      };
    }
    return {
      output: `[benchmark] ${task}`,
      handled: false,
      prependToPrompt: `You are running a SWE-bench benchmark task. Task: ${task}\n\nFollow the standard benchmark protocol: read the issue, understand the codebase, implement the fix, and verify with tests.`,
    };
  });
}
