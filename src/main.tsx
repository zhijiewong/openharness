#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { Command } from "commander";
import App, { DEFAULT_SYSTEM_PROMPT } from "./components/App.js";
import { getAllTools } from "./tools.js";
import type { PermissionMode } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("openharness")
  .description("Open-source terminal coding agent")
  .version(VERSION);

program
  .command("chat", { isDefault: true })
  .description("Start an interactive chat session")
  .option("-m, --model <model>", "Model to use")
  .option("--trust", "Trust all tool calls (skip permission prompts)")
  .option("--deny", "Deny all non-read tool calls")
  .option("--resume <sessionId>", "Resume a previous session")
  .action(async (opts) => {
    let permissionMode: PermissionMode = "ask";
    if (opts.trust) permissionMode = "trust";
    if (opts.deny) permissionMode = "deny";

    // Resolve provider — try to load from config or use a default
    let provider: Provider;
    try {
      const { createProvider } = await import("./providers/index.js");
      const result = await createProvider(opts.model);
      provider = result.provider;
    } catch {
      console.error(
        "No provider configured. Run `openharness init` to set up a provider.",
      );
      process.exit(1);
    }

    const tools = getAllTools();

    // TODO: Resume session from opts.resume if provided
    const initialMessages = undefined;

    render(
      <App
        provider={provider}
        tools={tools}
        permissionMode={permissionMode}
        systemPrompt={DEFAULT_SYSTEM_PROMPT}
        model={opts.model}
        initialMessages={initialMessages}
      />,
    );
  });

program
  .command("version")
  .description("Show version")
  .action(() => {
    console.log(`openharness v${VERSION}`);
  });

program
  .command("models")
  .description("List available models")
  .action(async () => {
    try {
      const { createProvider } = await import("./providers/index.js");
      const { provider } = await createProvider();
      const models = provider.listModels();
      console.log("Available models:");
      for (const m of models) {
        console.log(
          `  ${m.id} (${m.provider}) — context: ${m.contextWindow}, tools: ${m.supportsTools}`,
        );
      }
    } catch {
      console.error("No provider configured. Run `openharness init` first.");
    }
  });

program
  .command("tools")
  .description("List available tools")
  .action(() => {
    const tools = getAllTools();
    console.log("Available tools:");
    for (const t of tools) {
      console.log(`  ${t.name} [${t.riskLevel}] — ${t.description}`);
    }
  });

program
  .command("init")
  .description("Initialize configuration")
  .action(() => {
    console.log("TODO: Interactive setup wizard for provider configuration.");
    console.log("For now, set OPENAI_API_KEY or ANTHROPIC_API_KEY env vars.");
  });

program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    console.log("TODO: Show current configuration from ~/.openharness/config.yaml");
  });

program.parse();
