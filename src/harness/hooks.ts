/**
 * Hooks system — run commands, HTTP requests, or LLM prompts on lifecycle events.
 *
 * preToolUse hooks can block tool execution (exit code 1 / allowed: false).
 * All other hooks are fire-and-forget (errors are silently ignored).
 *
 * Hook types:
 * - command: shell script (existing)
 * - http: POST JSON to URL, expect { allowed: true/false }
 * - prompt: LLM yes/no check via provider.complete()
 */

import { spawn, spawnSync } from "node:child_process";
import type { HookDef, HooksConfig } from "./config.js";
import { readOhConfig } from "./config.js";

export type HookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "preToolUse"
  | "postToolUse"
  | "fileChanged"
  | "cwdChanged"
  | "subagentStart"
  | "subagentStop"
  | "preCompact"
  | "postCompact"
  | "configChange"
  | "notification";

export type HookContext = {
  toolName?: string;
  toolArgs?: string;
  toolOutput?: string;
  toolInputJson?: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  permissionMode?: string;
  cost?: string;
  tokens?: string;
  /** For fileChanged: the file path that changed */
  filePath?: string;
  /** For cwdChanged: the new working directory */
  newCwd?: string;
  /** For subagentStart/Stop: the agent ID */
  agentId?: string;
  /** For notification: the message */
  message?: string;
};

let cachedHooks: HooksConfig | null | undefined;

function getHooks(): HooksConfig | null {
  if (cachedHooks !== undefined) return cachedHooks;
  const cfg = readOhConfig();
  cachedHooks = cfg?.hooks ?? null;
  return cachedHooks;
}

/** Clear hook cache (call after config changes) */
export function invalidateHookCache(): void {
  cachedHooks = undefined;
}

function buildEnv(event: HookEvent, ctx: HookContext): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OH_EVENT: event,
  };
  if (ctx.toolName) env.OH_TOOL_NAME = ctx.toolName;
  if (ctx.toolArgs) env.OH_TOOL_ARGS = ctx.toolArgs;
  if (ctx.toolOutput) env.OH_TOOL_OUTPUT = ctx.toolOutput;
  if (ctx.toolInputJson) env.OH_TOOL_INPUT_JSON = ctx.toolInputJson;
  if (ctx.sessionId) env.OH_SESSION_ID = ctx.sessionId;
  if (ctx.model) env.OH_MODEL = ctx.model;
  if (ctx.provider) env.OH_PROVIDER = ctx.provider;
  if (ctx.permissionMode) env.OH_PERMISSION_MODE = ctx.permissionMode;
  if (ctx.cost) env.OH_COST = ctx.cost;
  if (ctx.tokens) env.OH_TOKENS = ctx.tokens;
  if (ctx.filePath) env.OH_FILE_PATH = ctx.filePath;
  if (ctx.newCwd) env.OH_NEW_CWD = ctx.newCwd;
  if (ctx.agentId) env.OH_AGENT_ID = ctx.agentId;
  if (ctx.message) env.OH_MESSAGE = ctx.message;
  return env;
}

/**
 * Evaluate a hook matcher against the current tool name.
 *
 * Supported forms (Claude Code compatible):
 *  - No matcher → always matches.
 *  - `/pattern/flags` → treated as a regex. Flags optional.
 *  - `mcp__server__tool` → literal match is a substring check (works for the
 *    standard `mcp__<server>__<tool>` naming convention).
 *  - `prefix*` or glob-ish → simple wildcard translated to regex.
 *  - Anything else → case-sensitive substring (legacy behavior — back-compat).
 */
/** @internal Exposed for testing. */
export function matchesHook(def: HookDef, ctx: HookContext): boolean {
  if (!def.match) return true;
  if (!ctx.toolName) return true;

  const match = def.match;

  // /regex/flags form
  if (match.length > 2 && match.startsWith("/")) {
    const lastSlash = match.lastIndexOf("/");
    if (lastSlash > 0) {
      try {
        const pattern = match.slice(1, lastSlash);
        const flags = match.slice(lastSlash + 1);
        return new RegExp(pattern, flags).test(ctx.toolName);
      } catch {
        return false;
      }
    }
  }

  // Simple glob: asterisks translated to `.*`, anchored. Only activates if the
  // match contains an asterisk — otherwise treat as substring for back-compat.
  if (match.includes("*")) {
    const escaped = match
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    try {
      return new RegExp(`^${escaped}$`).test(ctx.toolName);
    } catch {
      return false;
    }
  }

  // Legacy substring match
  return ctx.toolName.includes(match);
}

// ── Hook Executors ──

/** Run a command hook. Returns exit code (0 = success/allowed). */
function runCommandHookAsync(command: string, env: Record<string, string>, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(command, {
      shell: true,
      timeout: timeoutMs,
      stdio: "pipe",
      env,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        resolve(1);
      }
    }, timeoutMs);

    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(code ?? 1);
      }
    });

    proc.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(1);
      }
    });
  });
}

/** Run an HTTP hook. POSTs context as JSON, expects { allowed: true/false }. */
async function runHttpHook(url: string, event: HookEvent, ctx: HookContext, timeoutMs = 10_000): Promise<boolean> {
  try {
    const body = JSON.stringify({ event, ...ctx });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { allowed?: boolean };
    return data.allowed !== false;
  } catch {
    return false;
  }
}

/**
 * Run a prompt hook. Uses LLM to make a yes/no decision.
 *
 * Currently a stub — prompt hooks always allow because the hook system
 * runs outside the query loop and has no access to a Provider instance.
 * Full implementation requires passing a Provider via HookContext so the
 * hook can call provider.complete() with the prompt text.
 */
async function runPromptHook(_promptText: string, _ctx: HookContext): Promise<boolean> {
  return true;
}

// ── Hook Execution ──

/** Execute a single hook definition. Returns true if allowed. */
async function executeHookDef(def: HookDef, event: HookEvent, ctx: HookContext): Promise<boolean> {
  const timeout = def.timeout ?? 10_000;

  if (def.command) {
    const env = buildEnv(event, ctx);
    const code = await runCommandHookAsync(def.command, env, timeout);
    return code === 0;
  }

  if (def.http) {
    return runHttpHook(def.http, event, ctx, timeout);
  }

  if (def.prompt) {
    return runPromptHook(def.prompt, ctx);
  }

  return true; // No handler = allow
}

/**
 * Emit a hook event. For preToolUse, returns false if any hook blocks the call.
 *
 * preToolUse hooks run synchronously (they must block before tool execution).
 * All other hooks run asynchronously to avoid blocking the event loop.
 */
export function emitHook(event: HookEvent, ctx: HookContext = {}): boolean {
  const hooks = getHooks();
  if (!hooks) return true;

  const defs: HookDef[] = hooks[event] ?? [];
  const env = buildEnv(event, ctx);

  if (event === "preToolUse") {
    // preToolUse command hooks must be synchronous — they gate tool execution
    for (const def of defs) {
      if (!matchesHook(def, ctx)) continue;

      if (def.command) {
        const result = spawnSync(def.command, {
          shell: true,
          timeout: def.timeout ?? 10_000,
          stdio: "pipe",
          env,
        });
        if (result.status !== 0 || result.error) return false;
      }
      // HTTP and prompt hooks for preToolUse are handled in emitHookAsync
    }
    return true;
  }

  // All other hooks run asynchronously (fire-and-forget)
  for (const def of defs) {
    if (!matchesHook(def, ctx)) continue;
    executeHookDef(def, event, ctx).catch(() => {
      /* fire-and-forget: non-preToolUse hooks must not block the agent loop */
    });
  }
  return true;
}

/**
 * Async version of emitHook that waits for all hooks to complete.
 * Supports all hook types (command, HTTP, prompt).
 */
export async function emitHookAsync(event: HookEvent, ctx: HookContext = {}): Promise<boolean> {
  const hooks = getHooks();
  if (!hooks) return true;

  const defs: HookDef[] = hooks[event] ?? [];

  for (const def of defs) {
    if (!matchesHook(def, ctx)) continue;
    const allowed = await executeHookDef(def, event, ctx);
    if (event === "preToolUse" && !allowed) return false;
  }
  return true;
}
