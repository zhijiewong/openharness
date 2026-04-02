#!/usr/bin/env node
/**
 * OpenHarness CLI entry point.
 *
 * Usage:
 *   npx openharness                          # auto-detect provider, start chatting
 *   npx openharness --model ollama/llama3    # use specific model
 *   npx openharness models                   # list models
 *   npx openharness tools                    # list tools
 */

import React from "react";
import { render } from "ink";
import { Command, Option } from "commander";
import App from "./components/App.js";
import { getAllTools } from "./tools.js";
import { loadMcpTools, disconnectMcpClients, connectedMcpServers } from "./mcp/loader.js";
import { createRulesFile, loadRules, loadRulesAsPrompt } from "./harness/rules.js";
import { detectProject, projectContextToPrompt } from "./harness/onboarding.js";
import { MODEL_PRICING } from "./harness/cost.js";
import { listSessions } from "./harness/session.js";
import { readOhConfig } from "./harness/config.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";

const VERSION = "0.3.0";

const program = new Command();

program
  .name("openharness")
  .description("Open-source terminal coding agent. Works with any LLM.")
  .version(VERSION);

// ── Headless run command ──

const DEFAULT_SYSTEM_PROMPT = `You are OpenHarness, an AI coding assistant running in the user's terminal.
You have access to tools for reading, writing, and searching files, and running shell commands.
Always explain what you're about to do before using tools.`;

function buildSystemPrompt(): string {
  const parts: string[] = [DEFAULT_SYSTEM_PROMPT];

  const projectCtx = detectProject();
  const projectPrompt = projectContextToPrompt(projectCtx);
  if (projectPrompt) parts.push(projectPrompt);

  const rulesPrompt = loadRulesAsPrompt();
  if (rulesPrompt) parts.push(rulesPrompt);

  return parts.join("\n\n");
}

program
  .command("run")
  .description("Run a single prompt non-interactively")
  .argument("<prompt>", "The prompt to execute")
  .option("-m, --model <model>", "Model to use")
  .addOption(
    new Option("--permission-mode <mode>", "Permission mode")
      .choices(["ask", "trust", "deny"])
      .default("trust"),
  )
  .option("--trust", "Auto-approve all tools")
  .option("--deny", "Block all non-read tools")
  .option("--json", "Output as JSON")
  .option("--max-turns <n>", "Maximum turns", "20")
  .action(async (prompt: string, opts: Record<string, unknown>) => {
    const permissionMode: PermissionMode = (opts.trust
      ? "trust"
      : opts.deny
        ? "deny"
        : opts.permissionMode) as PermissionMode;

    const { createProvider } = await import("./providers/index.js");
    const { provider, model } = await createProvider(opts.model as string | undefined);
    const { query } = await import("./query.js");

    const tools = getAllTools();
    const systemPrompt = buildSystemPrompt();

    const config = {
      provider,
      tools,
      systemPrompt,
      permissionMode,
      maxTurns: parseInt(opts.maxTurns as string),
      model,
    };

    let fullOutput = "";
    const toolResults: Array<{ tool: string; output: string; error: boolean | undefined }> = [];
    const callIdToName: Record<string, string> = {};

    for await (const event of query(prompt, config)) {
      if (event.type === "text_delta") {
        fullOutput += event.content;
        if (!opts.json) process.stdout.write(event.content);
      } else if (event.type === "tool_call_start") {
        callIdToName[event.callId] = event.toolName;
        if (!opts.json) process.stderr.write(`[tool] ${event.toolName}\n`);
      } else if (event.type === "tool_call_end") {
        toolResults.push({
          tool: callIdToName[event.callId] || event.callId || "unknown",
          output: event.output,
          error: event.isError,
        });
        if (!opts.json && event.isError) process.stderr.write(`[error] ${event.output}\n`);
      } else if (event.type === "error") {
        if (!opts.json) process.stderr.write(`[error] ${event.message}\n`);
      } else if (event.type === "turn_complete") {
        if (event.reason !== "completed") {
          process.exitCode = 1;
        }
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ output: fullOutput, tools: toolResults }, null, 2));
    } else {
      process.stdout.write("\n");
    }
  });

// ── Default command: just run `openharness` to start chatting ──
program
  .command("chat", { isDefault: true })
  .description("Start an interactive chat session")
  .option("-m, --model <model>", "Model to use (e.g., ollama/llama3, gpt-4o)")
  .addOption(
    new Option("--permission-mode <mode>", "Permission mode")
      .choices(["ask", "trust", "deny"])
      .default("ask"),
  )
  .option("--trust", "Auto-approve all tool calls")
  .option("--deny", "Block all non-read tool calls")
  .option("--resume <id>", "Resume a saved session")
  .action(async (opts) => {
    // Load saved config as defaults (env vars + CLI flags override)
    const savedConfig = readOhConfig();
    const effectiveModel = opts.model ?? savedConfig?.model;
    const effectivePermMode: PermissionMode = opts.trust ? "trust" : opts.deny ? "deny"
      : opts.permissionMode !== "ask" ? opts.permissionMode as PermissionMode
      : (savedConfig?.permissionMode ?? "ask");

    // Auto-detect provider or prompt for setup
    let provider: Provider;
    let resolvedModel: string;
    try {
      const { createProvider } = await import("./providers/index.js");
      const result = await createProvider(effectiveModel, savedConfig?.apiKey ? { apiKey: savedConfig.apiKey, baseUrl: savedConfig.baseUrl } : undefined);
      provider = result.provider;
      resolvedModel = result.model;
    } catch (err) {
      // First-run experience: guide the user
      console.log();
      console.log("  Welcome to OpenHarness!");
      console.log();
      console.log("  To get started, choose a provider:");
      console.log();
      console.log("  Local (free, no API key):");
      console.log("    npx openharness --model ollama/llama3");
      console.log("    npx openharness --model ollama/qwen2.5:7b-instruct");
      console.log();
      console.log("  Cloud (needs API key in env var):");
      console.log("    OPENAI_API_KEY=sk-... npx openharness --model gpt-4o");
      console.log("    ANTHROPIC_API_KEY=sk-ant-... npx openharness --model claude-sonnet-4-6");
      console.log();
      console.log("  Make sure Ollama is running: ollama serve");
      console.log();
      process.exit(0);
    }

    const mcpTools = await loadMcpTools();
    const mcpNames = connectedMcpServers();
    if (mcpNames.length > 0) {
      console.log(`[mcp] Connected: ${mcpNames.join(', ')}`);
    }
    const tools = [...getAllTools(), ...mcpTools];

    process.on('exit', () => disconnectMcpClients());
    process.on('SIGINT', () => { disconnectMcpClients(); process.exit(0); });

    render(
      <App
        provider={provider}
        tools={tools}
        permissionMode={effectivePermMode}
        model={resolvedModel}
        resumeSessionId={opts.resume as string | undefined}
      />,
    );
  });

// ── models ──
program
  .command("models")
  .description("List available models and pricing")
  .action(async () => {
    console.log();
    console.log("  Model                         Provider     Input/1M    Output/1M");
    console.log("  " + "─".repeat(65));

    // Try listing Ollama local models
    try {
      const { createProvider } = await import("./providers/index.js");
      const { provider } = await createProvider("ollama/llama3");
      const ollamaModels = "fetchModels" in provider && typeof (provider as any).fetchModels === "function"
        ? await (provider as any).fetchModels()
        : provider.listModels();
      for (const m of ollamaModels) {
        console.log(`  ${m.id.padEnd(30)} ${"ollama".padEnd(12)} free`);
      }
    } catch { /* Ollama not running */ }

    // Cloud models from pricing registry
    for (const [model, [inp, out]] of Object.entries(MODEL_PRICING).sort()) {
      if (inp === 0) continue;
      console.log(
        `  ${model.padEnd(30)} ${guessProvider(model).padEnd(12)} $${inp.toFixed(2).padStart(6)}    $${out.toFixed(2).padStart(6)}`,
      );
    }
    console.log();
  });

// ── tools ──
program
  .command("tools")
  .description("List available tools and risk levels")
  .action(() => {
    const tools = getAllTools();
    console.log();
    console.log("  Tool       Risk     Description");
    console.log("  " + "─".repeat(55));
    for (const t of tools) {
      console.log(`  ${t.name.padEnd(10)} ${t.riskLevel.padEnd(8)} ${t.description.slice(0, 45)}`);
    }
    console.log();
  });

// ── init ──
program
  .command("init")
  .description("Initialize OpenHarness for the current project (interactive setup wizard)")
  .action(async () => {
    const { default: InitWizard } = await import("./components/InitWizard.js");
    const rulesPath = createRulesFile();
    const ctx = detectProject();
    console.log();
    if (ctx.language !== "unknown") {
      console.log(`  Detected: ${ctx.language}${ctx.framework ? ` (${ctx.framework})` : ""}`);
    }
    if (ctx.hasGit) {
      console.log(`  Git branch: ${ctx.gitBranch}`);
    }
    console.log(`  Rules file: ${rulesPath}`);
    console.log();
    const { waitUntilExit } = render(<InitWizard onDone={() => process.exit(0)} />);
    await waitUntilExit();
  });

// ── sessions ──
program
  .command("sessions")
  .description("List saved sessions")
  .action(() => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log("  No saved sessions.");
      return;
    }
    console.log();
    console.log("  ID           Model              Messages  Updated");
    console.log("  " + "─".repeat(55));
    for (const s of sessions.slice(0, 20)) {
      const date = new Date(s.updatedAt).toISOString().slice(0, 16);
      console.log(
        `  ${s.id.padEnd(13)} ${s.model.padEnd(18)} ${String(s.messages).padEnd(10)} ${date}`,
      );
    }
    console.log();
    console.log("  Resume: npx openharness --resume <ID>");
    console.log();
  });

// ── rules ──
program
  .command("rules")
  .description("Show project rules")
  .option("--init", "Create .oh/RULES.md")
  .action((opts: { init?: boolean }) => {
    if (opts.init) {
      console.log(`  Created: ${createRulesFile()}`);
      return;
    }
    const rules = loadRules();
    if (rules.length === 0) {
      console.log("  No rules. Run: npx openharness init");
      return;
    }
    console.log(`  ${rules.length} rule(s) loaded.`);
  });

// ── config ──
program
  .command("config")
  .description("Show or edit .oh/config.yaml")
  .action(() => {
    const cfg = readOhConfig();
    if (!cfg) {
      console.log("  No .oh/config.yaml — run: oh init");
      return;
    }
    console.log();
    console.log("  .oh/config.yaml");
    console.log("  " + "─".repeat(40));
    console.log(`  provider:       ${cfg.provider}`);
    console.log(`  model:          ${cfg.model}`);
    console.log(`  permissionMode: ${cfg.permissionMode}`);
    if (cfg.baseUrl)  console.log(`  baseUrl:        ${cfg.baseUrl}`);
    if (cfg.apiKey)   console.log(`  apiKey:         ${"*".repeat(8)}...`);
    console.log();
  });

// ── memory ──
program
  .command("memory")
  .description("List or search memories in .oh/memory/")
  .argument("[term]", "Search term")
  .action((term?: string) => {
    const memDir = join(homedir(), ".oh", "memory");
    if (!existsSync(memDir)) {
      console.log("  No memory directory found.");
      return;
    }
    const files = readdirSync(memDir).filter(f => f.endsWith(".md"));
    if (files.length === 0) { console.log("  No memories."); return; }

    const q = term?.toLowerCase();
    console.log();
    for (const file of files) {
      try {
        const content = readFileSync(join(memDir, file), "utf-8");
        if (q && !content.toLowerCase().includes(q)) continue;
        const name = content.match(/^name:\s*(.+)$/m)?.[1] ?? file;
        const type = content.match(/^type:\s*(.+)$/m)?.[1] ?? "?";
        const desc = content.match(/^description:\s*(.+)$/m)?.[1] ?? "";
        console.log(`  [${type.padEnd(8)}] ${name.padEnd(28)} ${desc.slice(0, 45)}`);
      } catch { /* skip */ }
    }
    console.log();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

function guessProvider(model: string): string {
  if (model.includes("gpt") || model.startsWith("o3")) return "openai";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("deepseek")) return "deepseek";
  if (model.includes("qwen")) return "qwen";
  return "unknown";
}
