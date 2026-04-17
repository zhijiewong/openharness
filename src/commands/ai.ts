/**
 * AI commands — /plan, /review, /roles, /agents, /plugins, /btw, /loop
 */

import { gitDiff, isGitRepo } from "../git/index.js";
import { handleCybergotchiCommand } from "./cybergotchi.js";
import type { CommandHandler } from "./types.js";

export function registerAICommands(register: (name: string, description: string, handler: CommandHandler) => void) {
  register("btw", "Ask a side question (ephemeral, no tools, not saved to history)", (args) => {
    if (!args.trim()) {
      return { output: "Usage: /btw <your question>", handled: true };
    }
    return {
      output: `[btw] ${args.trim()}`,
      handled: false,
      prependToPrompt: `[Side question — answer briefly without using any tools. This is ephemeral and not part of the main conversation.]\n\n${args.trim()}`,
    };
  });

  register("loop", "Run a prompt repeatedly with self-paced timing", (args) => {
    const input = args.trim();
    if (!input) {
      return {
        output:
          "Usage: /loop [interval] <prompt or /command>\n\nExamples:\n  /loop check if the build passed\n  /loop 5m /review\n\nOmit the interval to let the model self-pace via ScheduleWakeup.",
        handled: true,
      };
    }

    const intervalMatch = input.match(/^(\d+)(s|m|h)\s+(.+)$/);
    let intervalMs: number | null = null;
    let prompt: string;

    if (intervalMatch) {
      const [, num, unit, rest] = intervalMatch;
      const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 };
      intervalMs = parseInt(num, 10) * multipliers[unit];
      prompt = rest;
    } else {
      prompt = input;
    }

    const mode = intervalMs
      ? `Fixed interval: ${intervalMatch![1]}${intervalMatch![2]}`
      : "Dynamic (model self-paces via ScheduleWakeup)";

    return {
      output: `[loop] ${mode}\nPrompt: ${prompt}`,
      handled: false,
      prependToPrompt: intervalMs
        ? `You are in LOOP MODE (fixed interval: ${intervalMs / 1000}s). Execute this task, then use ScheduleWakeup with delaySeconds=${intervalMs / 1000} to schedule the next iteration.\n\nTask: ${prompt}`
        : `You are in LOOP MODE (dynamic pacing). Execute this task, then use ScheduleWakeup to schedule the next iteration at an appropriate interval. Choose your delay based on what you're waiting for. Omit the ScheduleWakeup call to end the loop.\n\nTask: ${prompt}`,
    };
  });

  register("plan", "Enter plan mode", (_args) => {
    const task = _args.trim();
    if (!task) {
      return { output: "Usage: /plan <what you want to build>", handled: true };
    }
    return {
      output: `[plan mode] ${task}`,
      handled: false,
      prependToPrompt: `You are in PLAN MODE. Do NOT write any code yet.\n\n1. Call EnterPlanMode to create a plan file in .oh/plans/\n2. Write your detailed implementation plan to that file (files to create/modify, key functions/types, data flow, edge cases)\n3. When the plan is complete, call ExitPlanMode to signal readiness for review\n\nTask: ${task}`,
    };
  });

  register("review", "Review recent code changes", () => {
    if (!isGitRepo()) {
      return { output: "Not a git repository.", handled: true };
    }
    const diff = gitDiff();
    if (!diff) return { output: "No changes to review.", handled: true };
    const lines = diff.split("\n").length;
    return {
      output: `[review] ${lines} lines of diff`,
      handled: false,
      prependToPrompt: `Review these uncommitted changes and give feedback on correctness, style, and potential issues:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`,
    };
  });

  register("roles", "List available agent specialization roles", () => {
    const { listRoles } = require("../agents/roles.js");
    const roles = listRoles();
    const lines = ["Available agent roles:\n"];
    for (const role of roles) {
      lines.push(`  ${role.id.padEnd(18)} ${role.name}`);
      lines.push(`  ${"".padEnd(18)} ${role.description}`);
      if (role.suggestedTools?.length) {
        lines.push(`  ${"".padEnd(18)} Tools: ${role.suggestedTools.join(", ")}`);
      }
      lines.push("");
    }
    lines.push("Usage: Agent({ subagent_type: 'code-reviewer', prompt: '...' })");
    return { output: lines.join("\n"), handled: true };
  });

  register("agents", "Discover running openHarness agents on this machine", () => {
    const { discoverAgents } = require("../services/a2a.js");
    const agents = discoverAgents();

    if (agents.length === 0) {
      return {
        output:
          "No other openHarness agents running on this machine.\n\nOther oh sessions will appear here automatically via the A2A protocol.",
        handled: true,
      };
    }

    const lines = [`Running Agents (${agents.length}):\n`];
    for (const agent of agents) {
      const age = Math.round((Date.now() - agent.registeredAt) / 60_000);
      lines.push(`  ${agent.name}`);
      lines.push(`    ID:       ${agent.id}`);
      lines.push(`    Provider: ${agent.provider ?? "unknown"} / ${agent.model ?? "unknown"}`);
      lines.push(`    Dir:      ${agent.workingDir ?? "unknown"}`);
      lines.push(`    Endpoint: ${agent.endpoint.type}${agent.endpoint.port ? `:${agent.endpoint.port}` : ""}`);
      lines.push(`    Uptime:   ${age}m`);
      lines.push(`    Caps:     ${agent.capabilities.map((c: any) => c.name).join(", ")}`);
      lines.push("");
    }

    lines.push("Send messages with: Agent({ prompt: 'ask the other agent...', allowed_tools: ['SendMessage'] })");
    return { output: lines.join("\n"), handled: true };
  });

  const pluginsHandler = (args: string) => {
    const { discoverPlugins, discoverSkills } = require("../harness/plugins.js");
    const {
      searchMarketplace,
      installPlugin,
      uninstallPlugin,
      getInstalledPlugins,
      listMarketplaces,
      addMarketplace,
      removeMarketplace,
      formatMarketplaceSearch,
      formatInstalledPlugins,
    } = require("../harness/marketplace.js");

    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] ?? "";
    const rest = parts.slice(1).join(" ");

    if (subcommand === "info" && rest) {
      const installed = getInstalledPlugins();
      const p = installed.find((x: { name: string }) => x.name === rest);
      if (!p) return { output: `Plugin "${rest}" not found among installed plugins.`, handled: true };
      const lines = [
        `${p.name}@${p.version}`,
        p.description ? `  ${p.description}` : "",
        p.author ? `  by ${p.author}` : "",
        p.license ? `  license: ${p.license}` : "",
        p.homepage ? `  homepage: ${p.homepage}` : "",
        p.keywords?.length ? `  keywords: ${p.keywords.join(", ")}` : "",
        `  marketplace: ${p.marketplace}`,
        `  cachePath: ${p.cachePath}`,
      ].filter(Boolean);
      return { output: lines.join("\n"), handled: true };
    }

    if (subcommand === "marketplace") {
      const action = parts[1];
      const source = parts.slice(2).join(" ");
      if (action === "add" && source) {
        const mp = addMarketplace(source);
        if (mp) return { output: `Added marketplace "${mp.name}" (${mp.plugins.length} plugins)`, handled: true };
        return { output: `Failed to add marketplace from "${source}"`, handled: true };
      }
      if (action === "remove" && source) {
        return {
          output: removeMarketplace(source) ? `Removed marketplace "${source}"` : `Marketplace "${source}" not found`,
          handled: true,
        };
      }
      const mps = listMarketplaces();
      if (mps.length === 0) {
        return {
          output:
            "No marketplaces configured.\n\nAdd one:\n  /plugins marketplace add owner/repo\n  /plugins marketplace add https://example.com/plugins",
          handled: true,
        };
      }
      const lines = [`Marketplaces (${mps.length}):\n`];
      for (const mp of mps) {
        lines.push(`  ${mp.name} — ${mp.plugins.length} plugins`);
      }
      return { output: lines.join("\n"), handled: true };
    }

    if (subcommand === "search") {
      const query = rest || "all";
      const results = searchMarketplace(query === "all" ? "" : query);
      return { output: formatMarketplaceSearch(results), handled: true };
    }

    if (subcommand === "install" && rest) {
      const [name, marketplace] = rest.split("@");
      const result = installPlugin(name!, marketplace);
      if (result) {
        return {
          output: `Installed ${result.name}@${result.version} from ${result.marketplace}\nCached at: ${result.cachePath}`,
          handled: true,
        };
      }
      return {
        output: `Failed to install "${rest}". Is it listed in a marketplace?\nRun /plugins search ${name} to check.`,
        handled: true,
      };
    }

    if (subcommand === "uninstall" && rest) {
      return { output: uninstallPlugin(rest) ? `Uninstalled "${rest}"` : `Plugin "${rest}" not found`, handled: true };
    }

    const plugins = discoverPlugins();
    const skills = discoverSkills();
    const marketplacePlugins = getInstalledPlugins();
    const lines: string[] = [];

    if (marketplacePlugins.length > 0) {
      lines.push(formatInstalledPlugins(marketplacePlugins));
      lines.push("");
    }

    if (plugins.length > 0) {
      lines.push(`Local Plugins (${plugins.length}):`);
      for (const p of plugins) {
        lines.push(`  ${p.name}@${p.version} — ${p.description || "no description"}`);
      }
      lines.push("");
    }

    if (skills.length > 0) {
      lines.push(`Skills (${skills.length}):`);
      for (const s of skills) {
        lines.push(`  ${s.source}:${s.name} — ${s.description || ""}`);
      }
      lines.push("");
    }

    if (lines.length === 0) {
      lines.push("No plugins or skills installed.");
    }

    lines.push("");
    lines.push("Commands:");
    lines.push("  /plugin info <name>              Show full manifest for a plugin");
    lines.push("  /plugin search <query>           Search marketplaces");
    lines.push("  /plugin install <name>           Install from marketplace");
    lines.push("  /plugin uninstall <name>         Remove a plugin");
    lines.push("  /plugin marketplace add <src>    Add a marketplace");
    lines.push("  /plugin marketplace              List marketplaces");

    return { output: lines.join("\n"), handled: true };
  };

  register("plugins", "Manage plugins: list, search, install, uninstall, marketplace, info", pluginsHandler);
  register("plugin", "Alias of /plugins (Claude Code-style singular)", pluginsHandler);

  register("cybergotchi", "Manage your cybergotchi — feed · pet · rest · status · rename · reset", (args) => {
    return handleCybergotchiCommand(args);
  });

  register("summarize", "Summarize the current conversation", (_args, ctx) => {
    if (ctx.messages.length === 0) {
      return { output: "No messages to summarize.", handled: true };
    }
    return {
      output: `[summarize] ${ctx.messages.length} messages`,
      handled: false,
      prependToPrompt: `Summarize this conversation concisely. Highlight the main topics discussed, decisions made, and any pending action items. Be brief but thorough.`,
    };
  });

  register("explain", "Explain a file or concept", (args) => {
    const topic = args.trim();
    if (!topic) {
      return {
        output:
          "Usage: /explain <file-path or concept>\n\nExamples:\n  /explain src/index.ts\n  /explain dependency injection\n  /explain the authentication flow",
        handled: true,
      };
    }
    return {
      output: `[explain] ${topic}`,
      handled: false,
      prependToPrompt: `Explain the following clearly and concisely. If it's a file path, read and explain its purpose, structure, and key functions. If it's a concept, explain it in the context of this project.\n\nTopic: ${topic}`,
    };
  });

  register("fix", "Fix a specific issue", (args) => {
    const issue = args.trim();
    if (!issue) {
      return {
        output:
          "Usage: /fix <issue description>\n\nExamples:\n  /fix the failing test in auth.test.ts\n  /fix TypeScript errors in src/utils.ts\n  /fix the broken import on line 42",
        handled: true,
      };
    }
    return {
      output: `[fix] ${issue}`,
      handled: false,
      prependToPrompt: `Fix the following issue. Diagnose the root cause, implement the fix, and verify it works. Be precise and minimal in your changes.\n\nIssue: ${issue}`,
    };
  });
}
