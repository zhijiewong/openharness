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
import { createRulesFile, loadRules } from "./harness/rules.js";
import { detectProject } from "./harness/onboarding.js";
import { MODEL_PRICING } from "./harness/cost.js";
import { listSessions } from "./harness/session.js";
import type { PermissionMode } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("openharness")
  .description("Open-source terminal coding agent. Build your own Claude Code with any LLM.")
  .version(VERSION);

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
    const permissionMode: PermissionMode = opts.trust
      ? "trust"
      : opts.deny
        ? "deny"
        : (opts.permissionMode as PermissionMode);

    // Auto-detect provider or prompt for setup
    let provider: Provider;
    let resolvedModel: string;
    try {
      const { createProvider } = await import("./providers/index.js");
      const result = await createProvider(opts.model);
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

    const tools = getAllTools();

    render(
      <App
        provider={provider}
        tools={tools}
        permissionMode={permissionMode}
        model={resolvedModel}
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
      for (const m of provider.listModels()) {
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
  .description("Initialize OpenHarness for the current project")
  .action(() => {
    const rulesPath = createRulesFile();
    const ctx = detectProject();
    console.log();
    console.log("  OpenHarness initialized!");
    console.log(`  Created: ${rulesPath}`);
    if (ctx.language !== "unknown") {
      console.log(`  Detected: ${ctx.language}${ctx.framework ? ` (${ctx.framework})` : ""}`);
    }
    if (ctx.hasGit) {
      console.log(`  Git branch: ${ctx.gitBranch}`);
    }
    console.log();
    console.log("  Next: npx openharness --model ollama/llama3");
    console.log();
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
