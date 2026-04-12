/**
 * Slash command system — /help, /clear, /diff, /undo, /cost, etc.
 *
 * Commands are processed in the REPL before being sent to the LLM.
 * If input starts with /, it's treated as a command.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gitBranch, gitCommit, gitDiff, gitLog, gitUndo, isGitRepo, isInMergeOrRebase } from "../git/index.js";
import { readOhConfig } from "../harness/config.js";
import { estimateMessageTokens } from "../harness/context-warning.js";
import { getContextWindow } from "../harness/cost.js";
import { loadKeybindings } from "../harness/keybindings.js";
import { createSession, listSessions, loadSession, saveSession } from "../harness/session.js";
import { connectedMcpServers } from "../mcp/loader.js";
import { compressMessages } from "../query/index.js";
import type { Message } from "../types/message.js";
import { handleCybergotchiCommand } from "./cybergotchi.js";

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
  /** If set, toggle fast mode */
  toggleFastMode?: boolean;
};

type CommandHandler = (args: string, context: CommandContext) => CommandResult;

export type CommandContext = {
  messages: Message[];
  model: string;
  providerName: string;
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
  const categories: Record<string, string[]> = {
    Session: ["clear", "compact", "export", "history", "browse", "resume", "fork", "pin", "unpin"],
    Git: ["diff", "undo", "rewind", "commit", "log"],
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
    ],
    Settings: ["theme", "vim", "companion", "fast", "keys", "effort", "sandbox", "permissions", "allowed-tools"],
    AI: ["plan", "review", "roles", "agents", "plugins", "btw", "loop"],
    Pet: ["cybergotchi"],
  };
  const lines: string[] = [];
  for (const [category, names] of Object.entries(categories)) {
    lines.push(`${category}:`);
    for (const name of names) {
      const cmd = commands.get(name);
      if (cmd) lines.push(`  /${name.padEnd(12)} ${cmd.description}`);
    }
    lines.push("");
  }
  // Include any uncategorized commands
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
    lines.push(`MCP servers: ${mcp.join(", ")}`);
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

register("rewind", "Restore files from checkpoint (interactive picker or last)", (args) => {
  const { rewindLastCheckpoint, listCheckpoints, checkpointCount } = require("../harness/checkpoints.js");

  const checkpoints = listCheckpoints();
  if (checkpoints.length === 0) {
    return { output: "No checkpoints available. Checkpoints are created before file modifications.", handled: true };
  }

  const idx = args.trim();

  // /rewind (no args) — show checkpoint list
  if (!idx) {
    const lines = [`Checkpoints (${checkpoints.length}):\n`];
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      const cp = checkpoints[i]!;
      const age = Math.round((Date.now() - cp.timestamp) / 60_000);
      lines.push(`  ${i + 1}. [${age}m ago] ${cp.description}`);
      lines.push(`     Files: ${cp.files.join(", ")}`);
    }
    lines.push("");
    lines.push("Usage: /rewind <number> to restore a specific checkpoint");
    lines.push("       /rewind last    to restore the most recent");
    return { output: lines.join("\n"), handled: true };
  }

  // /rewind last — restore most recent
  if (idx === "last") {
    const cp = rewindLastCheckpoint();
    if (!cp) return { output: "No checkpoints.", handled: true };
    return {
      output: `Rewound: ${cp.description}\nRestored ${cp.files.length} file(s): ${cp.files.join(", ")}\n${checkpointCount()} checkpoint(s) remaining.`,
      handled: true,
    };
  }

  // /rewind <n> — restore specific checkpoint
  const num = parseInt(idx, 10);
  if (Number.isNaN(num) || num < 1 || num > checkpoints.length) {
    return { output: `Invalid checkpoint number. Use 1-${checkpoints.length}.`, handled: true };
  }

  // Rewind to specific checkpoint (restore all from that point)
  let restored = 0;
  while (checkpointCount() >= num) {
    const cp = rewindLastCheckpoint();
    if (!cp) break;
    restored++;
    if (checkpointCount() < num) break;
  }

  return {
    output: `Rewound ${restored} checkpoint(s) to point #${num}.\n${checkpointCount()} checkpoint(s) remaining.`,
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
        const hit = full.messages.find((m) => typeof m.content === "string" && m.content.toLowerCase().includes(term));
        if (hit) {
          const date = new Date(s.updatedAt).toLocaleDateString();
          matches.push(`  ${s.id}  ${date}  ${s.model || "?"}`);
        }
      } catch {
        /* skip */
      }
    }
    if (matches.length === 0) return { output: `No sessions matching "${term}".`, handled: true };
    return { output: `Sessions matching "${term}":\n${matches.join("\n")}`, handled: true };
  }

  const n = parseInt(parts[0] ?? "10", 10) || 10;
  const sessions = listSessions(sessionDir).slice(0, n);
  if (sessions.length === 0) return { output: "No saved sessions.", handled: true };

  const lines = sessions.map((s) => {
    const date = new Date(s.updatedAt).toLocaleDateString();
    const cost = s.cost > 0 ? ` $${s.cost.toFixed(4)}` : "";
    return `  ${s.id}  ${date}  ${String(s.messages).padStart(3)} msgs  ${(s.model || "?").slice(0, 24)}${cost}`;
  });
  return { output: `Recent sessions (use /resume <id> to continue):\n${lines.join("\n")}`, handled: true };
});

register("theme", "Switch theme (dark/light)", (args) => {
  const theme = args.trim().toLowerCase();
  if (theme !== "dark" && theme !== "light") {
    return { output: "Usage: /theme dark or /theme light", handled: true };
  }
  return { output: `__SWITCH_THEME__:${theme}`, handled: true };
});

register("browse", "Open interactive session browser", () => {
  return { output: "__OPEN_SESSION_BROWSER__", handled: true };
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

register("fork", "Fork current session (create a branch you can resume later)", (_args, ctx) => {
  const forked = createSession("", "");
  forked.messages = [...ctx.messages];
  saveSession(forked);
  return {
    output: `Session forked as ${forked.id}. Resume later with: oh --resume ${forked.id}`,
    handled: true,
  };
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
  return { output: `Files in context:\n${[...files].map((f) => `  ${f}`).join("\n")}`, handled: true };
});

register("model", "Switch model (e.g., /model llama3.2 or /model ollama/llama3.2)", (args, ctx) => {
  const model = args.trim();
  if (!model)
    return { output: "Usage: /model <model-name>  (prefix with provider/ to switch providers)", handled: true };

  // Detect the provider implied by the new model
  let newProviderName: string;
  if (model.includes("/")) {
    newProviderName = model.split("/")[0]!;
  } else {
    // No prefix — assume current session's provider (don't guess)
    newProviderName = ctx.providerName;
  }

  if (newProviderName !== ctx.providerName) {
    return {
      output: `Cannot switch to '${model}': requires the '${newProviderName}' provider but current session uses '${ctx.providerName}'.\nRestart with: oh --model ${newProviderName}/${model.includes("/") ? model.split("/").slice(1).join("/") : model}`,
      handled: true,
    };
  }

  // Strip provider prefix if present (provider is already correct)
  const modelName = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  return { output: `Switched to ${modelName}.`, handled: true, newModel: modelName };
});

register("compact", "Compress conversation history (optional: focus keyword or message number)", (args, ctx) => {
  const focus = args.trim();
  const before = ctx.messages.length;
  const targetTokens = Math.floor(getContextWindow(ctx.model) * 0.6);

  if (focus && /^\d+$/.test(focus)) {
    // Numeric: compact messages 1-N, keep N+1 onwards
    const cutoff = parseInt(focus, 10);
    if (cutoff < 1 || cutoff >= before) {
      return { output: `Invalid: use 1-${before - 1}`, handled: true };
    }
    const kept = ctx.messages.slice(cutoff);
    return {
      output: `Compacted: removed first ${cutoff} messages, kept ${kept.length}.`,
      handled: true,
      compactedMessages: kept,
    };
  }

  if (focus) {
    // Keyword focus: compress but preserve messages containing the keyword
    const focusLower = focus.toLowerCase();
    const preserved = ctx.messages.filter((m) => m.content.toLowerCase().includes(focusLower) || m.meta?.pinned);
    const others = ctx.messages.filter((m) => !m.content.toLowerCase().includes(focusLower) && !m.meta?.pinned);
    const compactedOthers = compressMessages(others, targetTokens);
    const merged = [...compactedOthers, ...preserved].sort((a, b) => a.timestamp - b.timestamp);
    return {
      output: `Compacted with focus "${focus}": ${before} → ${merged.length} messages (preserved ${preserved.length} matching).`,
      handled: true,
      compactedMessages: merged,
    };
  }

  // Default: compress everything
  const compacted = compressMessages(ctx.messages, targetTokens);
  const dropped = before - compacted.length;
  return {
    output: `Compacted: ${before} → ${compacted.length} messages (dropped ${dropped} older turns).`,
    handled: true,
    compactedMessages: compacted,
  };
});

register("export", "Export conversation to file", (_args, ctx) => {
  const lines = ctx.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
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
    files = readdirSync(memDir).filter((f) => f.endsWith(".md"));
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

register("companion", "Toggle companion visibility (off/on)", (args) => {
  const arg = args.trim().toLowerCase();
  if (arg === "off") return { output: "__COMPANION_OFF__", handled: true };
  if (arg === "on") return { output: "__COMPANION_ON__", handled: true };
  return { output: "Usage: /companion off or /companion on", handled: true };
});

register("cybergotchi", "Manage your cybergotchi — feed · pet · rest · status · rename · reset", (args) => {
  return handleCybergotchiCommand(args);
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

register("fast", "Toggle fast mode (optimized for speed)", () => {
  return { output: "", handled: true, toggleFastMode: true };
});

register("keys", "Show keyboard shortcuts", () => {
  const bindings = loadKeybindings();

  const shortcuts = [
    "Keyboard Shortcuts:",
    "",
    "  Navigation:",
    "    ↑ / ↓           Input history",
    "    Tab              Cycle autocomplete suggestions",
    "    Escape           Cancel / clear autocomplete",
    "    Ctrl+C           Abort current request / exit",
    "    Scroll wheel     Scroll through messages",
    "",
    "  Editing:",
    "    Alt+Enter        Insert newline (multi-line input)",
    "    Ctrl+A           Move cursor to start of line",
    "    Ctrl+E           Move cursor to end of line",
    "",
    "  Display:",
    "    Ctrl+K           Toggle code block expansion",
    "    Ctrl+O           Toggle thinking block expansion",
    "    Tab (in output)  Expand/collapse tool call output",
    "",
    "  Custom keybindings (~/.oh/keybindings.json):",
  ];
  for (const b of bindings) {
    shortcuts.push(`    ${b.key.padEnd(18)} ${b.action}`);
  }
  shortcuts.push(
    "",
    "  Session:",
    "    /vim              Toggle Vim mode",
    "    /browse           Interactive session browser",
    "    /theme dark|light Switch theme",
  );
  return { output: shortcuts.join("\n"), handled: true };
});

register("sandbox", "Show sandbox status and restrictions", () => {
  const { sandboxStatus } = require("../harness/sandbox.js");
  return { output: `${sandboxStatus()}\n\nConfigure in .oh/config.yaml under sandbox:`, handled: true };
});

register("effort", "Set reasoning effort level (low/medium/high/max)", (args) => {
  const level = args.trim().toLowerCase();
  const valid = ["low", "medium", "high", "max"];
  if (!valid.includes(level)) {
    return {
      output: `Usage: /effort <${valid.join("|")}>\n\nlow    — fast, minimal reasoning\nmedium — balanced (default)\nhigh   — thorough reasoning\nmax    — maximum depth (Opus only)`,
      handled: true,
    };
  }
  return { output: `Effort level set to: ${level}`, handled: true };
});

register("btw", "Ask a side question (ephemeral, no tools, not saved to history)", (args) => {
  if (!args.trim()) {
    return { output: "Usage: /btw <your question>", handled: true };
  }
  // Side questions are answered directly without tools or history
  // The output is shown but NOT added to conversation history
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

  // Check for optional interval prefix like "5m", "30s", "2h"
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

register("plan", "Enter plan mode", (_args, _ctx) => {
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

register("doctor", "Run diagnostic health checks", (_args, ctx) => {
  const lines: string[] = [];
  const issues: string[] = [];

  lines.push("─── Health Check ───");
  lines.push("");

  // Provider & Model
  lines.push(`  Provider:      ${ctx.providerName || "⚠ not set"}`);
  lines.push(`  Model:         ${ctx.model || "⚠ not set"}`);
  lines.push(`  Permission:    ${ctx.permissionMode}`);
  if (!ctx.model) issues.push("No model configured. Use --model or set in .oh/config.yaml");

  // API Key check
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  if (ctx.providerName === "anthropic" && !hasAnthropicKey) {
    issues.push("ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=sk-...");
  }
  if (ctx.providerName === "openai" && !hasOpenAIKey) {
    issues.push("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=sk-...");
  }
  if (ctx.providerName === "ollama") {
    lines.push(`  Ollama:        checking...`);
    try {
      // Quick check if Ollama is running (sync fetch isn't available, just note it)
      lines.pop();
      lines.push(`  Ollama:        configured (ensure 'ollama serve' is running)`);
    } catch {
      issues.push("Ollama may not be running. Start with: ollama serve");
    }
  }

  // Context window
  const ctxWindow = getContextWindow(ctx.model);
  const totalTokens = estimateMessageTokens(ctx.messages);
  const usage = ctxWindow > 0 ? Math.round((totalTokens / ctxWindow) * 100) : 0;
  lines.push(`  Context:       ~${totalTokens.toLocaleString()} / ${ctxWindow.toLocaleString()} tokens (${usage}%)`);
  if (usage > 80) issues.push(`Context ${usage}% full. Consider /compact to free space.`);

  // Git
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

  // MCP
  const mcp = connectedMcpServers();
  lines.push(`  MCP servers:   ${mcp.length > 0 ? mcp.join(", ") : "none"}`);

  // Config
  const cfg = readOhConfig();
  lines.push(`  Config:        ${cfg ? ".oh/config.yaml ✓" : "not found"}`);

  // Session
  lines.push("");
  lines.push(`  Session:       ${ctx.sessionId}`);
  lines.push(`  Messages:      ${ctx.messages.length}`);
  lines.push(`  Cost:          $${ctx.totalCost.toFixed(4)}`);

  // Disk space & storage
  try {
    const ohDir = join(homedir(), ".oh");
    if (existsSync(ohDir)) {
      const sessionsDir = join(ohDir, "sessions");
      const sessCount = existsSync(sessionsDir)
        ? readdirSync(sessionsDir).filter((f) => f.endsWith(".json")).length
        : 0;
      lines.push(`  Sessions:      ${sessCount} saved`);
      if (sessCount > 80) issues.push(`${sessCount} saved sessions. Consider cleaning old ones.`);

      // Memory stats
      const memDir = join(ohDir, "memory");
      const memCount = existsSync(memDir) ? readdirSync(memDir).filter((f) => f.endsWith(".md")).length : 0;
      lines.push(`  Memories:      ${memCount} global`);

      // Cron stats
      const cronDir = join(ohDir, "crons");
      const cronCount = existsSync(cronDir) ? readdirSync(cronDir).filter((f) => f.endsWith(".json")).length : 0;
      lines.push(`  Cron tasks:    ${cronCount}`);
    }
  } catch {
    /* ignore */
  }

  // Project-level stats
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

  // Global config
  const globalCfg = existsSync(join(homedir(), ".oh", "config.yaml"));
  lines.push(`  Global config: ${globalCfg ? "~/.oh/config.yaml ✓" : "not set (optional)"}`);

  // Verification config
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

  // Tools
  lines.push("");
  lines.push(`  Tools:         ${ctx.messages.length > 0 ? "ready" : "loaded"}`);

  // Node.js version
  lines.push(`  Node.js:       ${process.version}`);
  const [major] = process.version.slice(1).split(".").map(Number);
  if (major && major < 18) issues.push(`Node.js ${process.version} is below minimum (18+). Upgrade Node.js.`);

  // Issues summary
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

  // Categorize messages by type
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

  // Visual bar (30 chars wide)
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
    // Show full registry
    const output = `MCP Server Registry (${MCP_REGISTRY.length} servers)\n${"─".repeat(50)}\n\n${formatRegistry()}\n\nUsage:\n  /mcp-registry <name>    Show install config for a server\n  /mcp-registry <keyword> Search by name, description, or category`;
    return { output, handled: true };
  }

  // Search or show specific server
  const results = searchRegistry(query);
  if (results.length === 0) {
    return { output: `No MCP servers found matching "${query}".`, handled: true };
  }

  if (results.length === 1) {
    // Show install instructions
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

  // Multiple results
  return { output: `Found ${results.length} servers:\n\n${formatRegistry(results)}`, handled: true };
});

function setPinned(args: string, ctx: CommandContext, pinned: boolean): CommandResult {
  const idx = parseInt(args.trim(), 10);
  if (Number.isNaN(idx) || idx < 1 || idx > ctx.messages.length) {
    return { output: `Usage: /${pinned ? "pin" : "unpin"} <message-number> (1-${ctx.messages.length})`, handled: true };
  }
  // Immutable update — replace message with updated meta
  const updatedMessages = ctx.messages.map((m, i) => (i === idx - 1 ? { ...m, meta: { ...m.meta, pinned } } : m));
  return {
    output: `Message #${idx} ${pinned ? "pinned" : "unpinned"}.`,
    handled: true,
    compactedMessages: updatedMessages,
  };
}

register("pin", "Pin a message (survives /compact)", (args, ctx) => setPinned(args, ctx, true));
register("unpin", "Unpin a message", (args, ctx) => setPinned(args, ctx, false));

register("plugins", "Manage plugins: list, search, install, uninstall, marketplace", (args) => {
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

  // /plugins marketplace add <source>
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
    // List marketplaces
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

  // /plugins search <query>
  if (subcommand === "search") {
    const query = rest || "all";
    const results = searchMarketplace(query === "all" ? "" : query);
    return { output: formatMarketplaceSearch(results), handled: true };
  }

  // /plugins install <name>
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

  // /plugins uninstall <name>
  if (subcommand === "uninstall" && rest) {
    return { output: uninstallPlugin(rest) ? `Uninstalled "${rest}"` : `Plugin "${rest}" not found`, handled: true };
  }

  // /plugins (no args) — show everything
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
  lines.push("  /plugins search <query>          Search marketplaces");
  lines.push("  /plugins install <name>          Install from marketplace");
  lines.push("  /plugins uninstall <name>        Remove a plugin");
  lines.push("  /plugins marketplace add <src>   Add a marketplace");
  lines.push("  /plugins marketplace             List marketplaces");

  return { output: lines.join("\n"), handled: true };
});

// ── Project Init ──

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

// ── Permissions ──

register("permissions", "View or change permission mode", (args, ctx) => {
  const mode = args.trim().toLowerCase();
  if (!mode) {
    return {
      output: `Current permission mode: ${ctx.permissionMode}\n\nAvailable modes:\n  ask            Prompt for medium/high risk (default)\n  trust          Auto-approve everything\n  deny           Only low-risk read-only\n  acceptEdits    Auto-approve file edits\n  plan           Read-only mode\n  auto           Auto-approve, block dangerous bash\n  bypassPermissions  CI/CD only`,
      handled: true,
    };
  }
  const valid = ["ask", "trust", "deny", "acceptedits", "plan", "auto", "bypasspermissions"];
  if (!valid.includes(mode)) {
    return { output: `Unknown mode: ${mode}. Valid: ${valid.join(", ")}`, handled: true };
  }
  return {
    output: `Permission mode set to: ${mode}\n(Note: takes effect for new tool calls in this session)`,
    handled: true,
  };
});

register("allowed-tools", "View tool permission rules", () => {
  const config = readOhConfig();
  const rules = config?.toolPermissions;
  if (!rules || rules.length === 0) {
    return {
      output:
        'No custom tool permission rules configured.\n\nAdd rules to .oh/config.yaml:\n\ntoolPermissions:\n  - tool: Bash\n    action: ask\n    pattern: "^rm .*"',
      handled: true,
    };
  }
  const lines = rules.map((r: any) => {
    const parts = [`  ${r.tool}: ${r.action}`];
    if (r.pattern) parts.push(`(pattern: ${r.pattern})`);
    return parts.join(" ");
  });
  return { output: `Tool permission rules:\n${lines.join("\n")}`, handled: true };
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
