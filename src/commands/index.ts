/**
 * Slash command system — /help, /clear, /diff, /undo, /cost, etc.
 *
 * Commands are processed in the REPL before being sent to the LLM.
 * If input starts with /, it's treated as a command.
 *
 * Command implementations are split into domain-specific modules:
 *   session.ts  — /clear, /compact, /export, /history, /browse, /resume, /fork, /pin, /unpin
 *   git.ts      — /diff, /undo, /rewind, /commit, /log
 *   info.ts     — /help, /cost, /status, /config, /files, /model, /memory, /doctor, /context, /mcp, /init
 *   settings.ts — /theme, /companion, /fast, /keys, /effort, /sandbox, /permissions, /allowed-tools
 *   ai.ts       — /plan, /review, /roles, /agents, /plugins, /btw, /loop, /cybergotchi
 *   skills.ts   — /skill-create, /skill-delete, /skill-edit, /skill-search, /skill-install
 */

export type { CommandContext, CommandHandler, CommandResult } from "./types.js";

import { registerAICommands } from "./ai.js";
import { registerGitCommands } from "./git.js";
import { registerInfoCommands } from "./info.js";
import { registerSessionCommands } from "./session.js";
import { registerSettingsCommands } from "./settings.js";
import { registerSkillCommands } from "./skills.js";
import type { CommandContext, CommandHandler, CommandResult } from "./types.js";

// ── Command Registry ──

const commands = new Map<string, { description: string; handler: CommandHandler }>();

function register(name: string, description: string, handler: CommandHandler) {
  commands.set(name, { description, handler });
}

// Register all command groups
registerSessionCommands(register);
registerGitCommands(register);
registerInfoCommands(register, () => commands);
registerSettingsCommands(register);
registerAICommands(register);
registerSkillCommands(register);

// ── Command Parser ──

/**
 * Check if input is a slash command. If so, execute it.
 */
export async function processSlashCommand(input: string, context: CommandContext): Promise<CommandResult | null> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  // Resolve aliases
  const aliases: Record<string, string> = {
    h: "help",
    c: "commit",
    m: "model",
    s: "status",
  };
  const resolved = aliases[name] ?? name;
  const cmd = commands.get(resolved);
  if (!cmd) {
    return {
      output: `Unknown command: /${name}. Type /help for available commands.`,
      handled: true,
    };
  }

  return cmd.handler(args, context);
}

/**
 * Get all registered command names (for autocomplete/display).
 */
export function getCommandNames(): string[] {
  return [...commands.keys()];
}

export function getCommandEntries(): Array<{ name: string; description: string }> {
  return [...commands.entries()].map(([name, { description }]) => ({ name, description }));
}
