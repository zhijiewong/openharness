/**
 * Slash command system — /help, /clear, /diff, /undo, /cost, etc.
 *
 * Commands are processed in the REPL before being sent to the LLM.
 * If input starts with /, it's treated as a command.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { isGitRepo, gitDiff, gitUndo, gitCommit, gitLog, gitBranch } from "../git/index.js";
import type { Message } from "../types/message.js";
import { handleCybergotchiCommand } from "./cybergotchi.js";
import { connectedMcpServers } from "../mcp/loader.js";
import { listSessions, loadSession } from "../harness/session.js";
import { readOhConfig } from "../harness/config.js";
import { homedir } from "node:os";
import { join } from "node:path";

export type CommandResult = {
  /** Text output to display */
  output: string;
  /** If true, don't send to LLM */
  handled: boolean;
  /** If set, clear messages */
  clearMessages?: boolean;
  /** If set, update model */
  newModel?: string;
  /** If set, replace messages with compacted version */
  compactedMessages?: Message[];
  /** If true, open the cybergotchi setup UI */
  openCybergotchiSetup?: boolean;
  /** If set, resume this session ID */
  resumeSessionId?: string;
  /** If set, prepend this text to the user's prompt before sending to LLM */
  prependToPrompt?: string;
};

type CommandHandler = (args: string, context: CommandContext) => CommandResult;

export type CommandContext = {
  messages: Message[];
  model: string;
  permissionMode: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionId: string;
};

const commands = new Map<string, { description: string; handler: CommandHandler }>();

function register(name: string, description: string, handler: CommandHandler) {
  commands.set(name, { description, handler });
}

// ── Register all commands ──

register("help", "Show available commands", () => {
  const lines = ["Available commands:\n"];
  for (const [name, { description }] of commands) {
    lines.push(`  /${name.padEnd(12)} ${description}`);
  }
  return { output: lines.join("\n"), handled: true };
});

register("clear", "Clear conversation history", () => {
  return { output: "Conversation cleared.", handled: true, clearMessages: true };
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
    lines.push(`MCP servers: ${mcp.join(', ')}`);
  }
  return { output: lines.join("\n"), handled: true };
});

register("diff", "Show uncommitted git changes", () => {
  if (!isGitRepo()) {
    return { output: "Not a git repository.", handled: true };
  }
  const diff = gitDiff();
  return { output: diff || "No uncommitted changes.", handled: true };
});

register("undo", "Undo last AI commit", () => {
  if (!isGitRepo()) {
    return { output: "Not a git repository.", handled: true };
  }
  const success = gitUndo();
  return {
    output: success ? "Undone. Last AI commit reverted." : "Nothing to undo (last commit wasn't from OpenHarness).",
    handled: true,
  };
});

register("commit", "Create a git commit", (args) => {
  if (!isGitRepo()) {
    return { output: "Not a git repository.", handled: true };
  }
  const message = args.trim() || "manual commit";
  const success = gitCommit(message);
  return { output: success ? `Committed: ${message}` : "Nothing to commit.", handled: true };
});

register("log", "Show recent git commits", () => {
  if (!isGitRepo()) {
    return { output: "Not a git repository.", handled: true };
  }
  return { output: gitLog(10) || "No commits yet.", handled: true };
});

register("history", "List recent sessions or search across them", (args) => {
  const parts = args.trim().split(/\s+/);
  const sessionDir = join(homedir(), ".oh", "sessions");

  if (parts[0] === "search" && parts[1]) {
    const term = parts.slice(1).join(" ").toLowerCase();
    const sessions = listSessions(sessionDir);
    const matches: string[] = [];
    for (const s of sessions) {
      try {
        const full = loadSession(s.id, sessionDir);
        const hit = full.messages.find(m =>
          typeof m.content === "string" && m.content.toLowerCase().includes(term)
        );
        if (hit) {
          const date = new Date(s.updatedAt).toLocaleDateString();
          matches.push(`  ${s.id}  ${date}  ${s.model || "?"}`);
        }
      } catch { /* skip */ }
    }
    if (matches.length === 0) return { output: `No sessions matching "${term}".`, handled: true };
    return { output: `Sessions matching "${term}":\n${matches.join("\n")}`, handled: true };
  }

  const n = parseInt(parts[0] ?? "10", 10) || 10;
  const sessions = listSessions(sessionDir).slice(0, n);
  if (sessions.length === 0) return { output: "No saved sessions.", handled: true };

  const lines = sessions.map(s => {
    const date = new Date(s.updatedAt).toLocaleDateString();
    const cost = s.cost > 0 ? ` $${s.cost.toFixed(4)}` : "";
    return `  ${s.id}  ${date}  ${String(s.messages).padStart(3)} msgs  ${(s.model || "?").slice(0, 24)}${cost}`;
  });
  return { output: `Recent sessions (use /resume <id> to continue):\n${lines.join("\n")}`, handled: true };
});

register("resume", "Resume a saved session by ID", (args) => {
  const id = args.trim();
  if (!id) return { output: "Usage: /resume <session-id>", handled: true };
  const sessionDir = join(homedir(), ".oh", "sessions");
  try {
    loadSession(id, sessionDir); // validate it exists
    return { output: `Resuming session ${id}...`, handled: true, resumeSessionId: id };
  } catch {
    return { output: `Session not found: ${id}`, handled: true };
  }
});

register("files", "List files in context", (_args, ctx) => {
  const files = new Set<string>();
  for (const msg of ctx.messages) {
    // Extract file paths from tool calls
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const path = (tc.arguments as any)?.file_path ?? (tc.arguments as any)?.path;
        if (path) files.add(String(path));
      }
    }
  }
  if (files.size === 0) return { output: "No files in context yet.", handled: true };
  return { output: `Files in context:\n${[...files].map(f => `  ${f}`).join("\n")}`, handled: true };
});

register("model", "Switch model (e.g., /model gpt-4o)", (args) => {
  const model = args.trim();
  if (!model) return { output: "Usage: /model <model-name>", handled: true };
  return { output: `Switched to ${model}.`, handled: true, newModel: model };
});

register("compact", "Compress conversation history", (_args, ctx) => {
  const before = ctx.messages.length;
  const keepLast = 10;
  const messages = ctx.messages;

  // Keep system messages + the most recent keepLast non-system messages
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  const kept = nonSystem.slice(-keepLast);

  const compacted = [...systemMsgs, ...kept];
  const dropped = before - compacted.length;

  return {
    output: `Compacted: ${before} → ${compacted.length} messages (dropped ${dropped} older turns).`,
    handled: true,
    compactedMessages: compacted,
  };
});

register("export", "Export conversation to file", (_args, ctx) => {
  const lines = ctx.messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const filename = `.oh/export-${ctx.sessionId}.md`;
  try {
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, lines);
    return { output: `Exported to ${filename}`, handled: true };
  } catch {
    return { output: `Export failed. Content:\n\n${lines.slice(0, 500)}`, handled: true };
  }
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

register("memory", "View and search memories in .oh/memory/", (args) => {
  const memDir = join(process.cwd(), ".oh", "memory");
  if (!existsSync(memDir)) {
    return { output: "No .oh/memory/ directory found. Memories are stored there by the AI.", handled: true };
  }

  const term = args.trim().toLowerCase();
  let files: string[];
  try {
    files = readdirSync(memDir).filter(f => f.endsWith(".md"));
  } catch {
    return { output: "Could not read .oh/memory/", handled: true };
  }
  if (files.length === 0) return { output: "No memories stored yet.", handled: true };

  if (term) {
    // Search mode
    const matches: string[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(memDir, file), "utf-8");
        if (content.toLowerCase().includes(term)) {
          const firstLine = content.split("\n").find(l => l.trim() && !l.startsWith("---")) ?? file;
          matches.push(`  ${file.padEnd(30)} ${firstLine.slice(0, 50)}`);
        }
      } catch { /* skip */ }
    }
    if (matches.length === 0) return { output: `No memories matching "${term}".`, handled: true };
    return { output: `Memories matching "${term}":\n${matches.join("\n")}`, handled: true };
  }

  // List mode
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

register("cybergotchi", "Manage your cybergotchi — feed · pet · rest · status · rename · reset", (args) => {
  return handleCybergotchiCommand(args);
});

register("plan", "Enter plan mode", (_args, _ctx) => {
  const task = _args.trim();
  if (!task) {
    return { output: "Usage: /plan <what you want to build>", handled: true };
  }
  return {
    output: `[plan mode] ${task}`,
    handled: false,
    prependToPrompt: `You are in PLAN MODE. Do NOT write any code yet. Instead, produce a detailed implementation plan as a numbered list covering: files to create/modify, key functions/types, data flow, and edge cases. Only after the plan is approved should you implement anything.\n\nTask: ${task}`,
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

// ── Command Parser ──

/**
 * Check if input is a slash command. If so, execute it.
 */
export function processSlashCommand(input: string, context: CommandContext): CommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  const cmd = commands.get(name);
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
