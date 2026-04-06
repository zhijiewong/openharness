/**
 * Hooks system — run shell commands on lifecycle events.
 *
 * preToolUse hooks can block tool execution (exit code 1 = block).
 * All other hooks are fire-and-forget (errors are silently ignored).
 */

import { spawn, spawnSync } from "node:child_process";
import type { HookDef, HooksConfig } from "./config.js";
import { readOhConfig } from "./config.js";

export type HookEvent = "sessionStart" | "sessionEnd" | "preToolUse" | "postToolUse";

export type HookContext = {
  toolName?: string;
  toolArgs?: string;
  toolOutput?: string;
};

let cachedHooks: HooksConfig | null | undefined;

function getHooks(): HooksConfig | null {
  if (cachedHooks !== undefined) return cachedHooks;
  const cfg = readOhConfig();
  cachedHooks = cfg?.hooks ?? null;
  return cachedHooks;
}

function buildEnv(event: HookEvent, ctx: HookContext): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OH_EVENT: event,
  };
  if (ctx.toolName) env.OH_TOOL_NAME = ctx.toolName;
  if (ctx.toolArgs) env.OH_TOOL_ARGS = ctx.toolArgs;
  if (ctx.toolOutput) env.OH_TOOL_OUTPUT = ctx.toolOutput;
  return env;
}

function matchesHook(def: HookDef, ctx: HookContext): boolean {
  if (def.match && ctx.toolName && !ctx.toolName.includes(def.match)) {
    return false;
  }
  return true;
}

/**
 * Run a single hook command asynchronously.
 * Returns a promise that resolves with the exit code (0 = success).
 */
function runHookAsync(command: string, env: Record<string, string>, timeoutMs = 10_000): Promise<number> {
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
        resolve(1); // timeout = failure
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
    // preToolUse must be synchronous — it gates tool execution
    for (const def of defs) {
      if (!matchesHook(def, ctx)) continue;
      const result = spawnSync(def.command, {
        shell: true,
        timeout: 10_000,
        stdio: "pipe",
        env,
      });
      if (result.status !== 0 || result.error) {
        return false;
      }
    }
    return true;
  }

  // All other hooks run asynchronously (fire-and-forget)
  for (const def of defs) {
    if (!matchesHook(def, ctx)) continue;
    runHookAsync(def.command, env).catch(() => {/* ignore */});
  }
  return true;
}

/**
 * Async version of emitHook that waits for all hooks to complete.
 * Useful for sessionEnd where you want to ensure hooks finish.
 */
export async function emitHookAsync(event: HookEvent, ctx: HookContext = {}): Promise<boolean> {
  const hooks = getHooks();
  if (!hooks) return true;

  const defs: HookDef[] = hooks[event] ?? [];
  const env = buildEnv(event, ctx);

  for (const def of defs) {
    if (!matchesHook(def, ctx)) continue;
    const code = await runHookAsync(def.command, env);
    if (event === "preToolUse" && code !== 0) {
      return false;
    }
  }
  return true;
}
