/**
 * Hooks system — run shell commands on lifecycle events.
 *
 * preToolUse hooks can block tool execution (exit code 1 = block).
 * All other hooks are fire-and-forget (errors are silently ignored).
 */

import { spawnSync } from "node:child_process";
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

/**
 * Emit a hook event. For preToolUse, returns false if any hook blocks the call.
 */
export function emitHook(event: HookEvent, ctx: HookContext = {}): boolean {
  const hooks = getHooks();
  if (!hooks) return true;

  const defs: HookDef[] = hooks[event] ?? [];

  for (const def of defs) {
    // Filter by tool name if match is specified
    if (def.match && ctx.toolName && !ctx.toolName.includes(def.match)) {
      continue;
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      OH_EVENT: event,
    };
    if (ctx.toolName) env.OH_TOOL_NAME = ctx.toolName;
    if (ctx.toolArgs) env.OH_TOOL_ARGS = ctx.toolArgs;
    if (ctx.toolOutput) env.OH_TOOL_OUTPUT = ctx.toolOutput;

    const result = spawnSync(def.command, {
      shell: true,
      timeout: 10_000,
      stdio: "pipe",
      env,
    });

    // preToolUse: non-zero exit blocks the tool call
    if (event === "preToolUse" && result.status !== 0) {
      return false;
    }
  }

  return true;
}
