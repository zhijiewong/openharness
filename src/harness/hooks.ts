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
  | "postToolUseFailure"
  | "userPromptSubmit"
  | "permissionRequest"
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
  /** For userPromptSubmit: the raw prompt text the user is about to submit */
  prompt?: string;
  /** For postToolUseFailure: short error label ("TimeoutError", "ExecutionError", "ReportedError") */
  toolError?: string;
  /** For postToolUseFailure: full error message */
  errorMessage?: string;
  /** For permissionRequest: the decision OH would take absent the hook ("ask", "allow", "deny") — informational */
  permissionAction?: "ask" | "allow" | "deny";
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

/**
 * Run a JSON-mode command hook and return the raw stdout string.
 *
 * Rejects (throws) on timeout or spawn error so callers can decide how to
 * interpret the failure. Returns an empty string when stdout is empty.
 * Rejects when the process exits with a non-zero code (callers treat this as
 * a block).
 */
function runJsonIoHookCaptureStdout(
  command: string,
  env: Record<string, string>,
  event: HookEvent,
  ctx: HookContext,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      shell: true,
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let settled = false;
    let stdoutBuf = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error("hook timed out"));
      }
    }, timeoutMs);

    proc.stdout?.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });

    // Write the event + context JSON envelope to stdin then close it so the
    // hook knows there's no more input coming.
    try {
      const payload = JSON.stringify({ event, ...ctx });
      proc.stdin?.end(payload);
    } catch {
      /* stdin already closed — ignore */
    }

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if ((code ?? 1) !== 0) {
        reject(new Error(`hook exited with code ${code ?? 1}`));
        return;
      }

      resolve(stdoutBuf);
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

/**
 * Run a JSON-mode command hook (Claude Code convention).
 *
 * Sends `{event, ...context}` as JSON on stdin. Parses stdout as JSON
 * `{ decision: "allow" | "deny", reason?: string, hookSpecificOutput?: any }`.
 *
 * Gating logic:
 *   - `decision: "deny"` → blocks (returns false).
 *   - `decision: "allow"` or omitted decision → allow (returns true).
 *   - Non-zero exit code → block.
 *   - Invalid/empty JSON on stdout → fall back to exit code (0 = allow).
 *   - Timeout or spawn error → block.
 */
async function runJsonIoHookAsync(
  command: string,
  env: Record<string, string>,
  event: HookEvent,
  ctx: HookContext,
  timeoutMs = 10_000,
): Promise<boolean> {
  let stdout: string;
  try {
    stdout = await runJsonIoHookCaptureStdout(command, env, event, ctx, timeoutMs);
  } catch {
    // timeout, spawn error, or non-zero exit — block
    return false;
  }

  // Empty stdout → treat exit code as the signal (allow for exit 0).
  if (!stdout.trim()) {
    return true;
  }

  try {
    const parsed = JSON.parse(stdout) as { decision?: string };
    return parsed.decision !== "deny";
  } catch {
    // Malformed JSON with a zero exit — fail closed conservatively.
    return false;
  }
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
 * Run a prompt hook. Uses an LLM to make a yes/no allow/deny decision.
 *
 * The hook's `prompt:` field is the question posed to the model along with
 * the event context. The response is parsed case-insensitively: responses
 * starting with YES / ALLOW / TRUE / PASS / APPROVE allow; anything else
 * (including explicit NO, DENY, errors, timeouts, empty) blocks.
 *
 * Fail-closed semantics: if the provider isn't reachable or the response
 * can't be parsed, the hook denies. This matches command hooks (non-zero
 * exit = deny) and HTTP hooks (network error = deny).
 *
 * Provider selection: reads `.oh/config.yaml` to get the configured provider
 * and model. A separate provider instance is created per call — no caching,
 * since hooks are rare and cold-start cost is negligible compared to the
 * LLM call itself.
 */
async function runPromptHook(promptText: string, ctx: HookContext, timeoutMs = 10_000): Promise<boolean> {
  try {
    const cfg = readOhConfig();
    if (!cfg) return false; // no config → no provider → fail closed

    const { createProvider } = (await import("../providers/index.js")) as typeof import("../providers/index.js");
    const modelArg = cfg.model ? `${cfg.provider}/${cfg.model}` : cfg.provider;
    const overrides: Partial<import("../providers/base.js").ProviderConfig> = {};
    if (cfg.apiKey) overrides.apiKey = cfg.apiKey;
    if (cfg.baseUrl) overrides.baseUrl = cfg.baseUrl;
    const { provider, model } = await createProvider(modelArg, overrides);

    const systemPrompt =
      "You are a policy gate. Read the question and the event context. Answer with a single word: YES to allow, NO to deny. Do not explain unless asked.";
    const userContent = [
      `Question: ${promptText}`,
      "",
      "Event context:",
      JSON.stringify({ event: ctx }, null, 2),
      "",
      "Answer (YES or NO):",
    ].join("\n");

    const { createUserMessage } = (await import("../types/message.js")) as typeof import("../types/message.js");
    const messages = [createUserMessage(userContent)];

    // Race the completion against a hard timeout so a hung provider doesn't
    // block the agent loop indefinitely.
    const completion = await Promise.race([
      provider.complete(messages, systemPrompt, undefined, model),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!completion) return false; // timeout → deny
    const text = (completion.content ?? "").trim().toUpperCase();
    if (!text) return false;
    // Accept multiple allow synonyms; default to deny on anything else.
    return /^(YES|ALLOW|TRUE|PASS|APPROVE)\b/.test(text);
  } catch {
    return false; // any error path → deny
  }
}

// ── Hook Execution ──

/** Execute a single hook definition. Returns true if allowed. */
async function executeHookDef(def: HookDef, event: HookEvent, ctx: HookContext): Promise<boolean> {
  const timeout = def.timeout ?? 10_000;

  if (def.command) {
    const env = buildEnv(event, ctx);
    // JSON-mode (Claude Code convention): send `{event, ...ctx}` on stdin,
    // parse `{decision}` from stdout. Env-var mode (legacy default): gate on
    // exit code.
    if (def.jsonIO) {
      return runJsonIoHookAsync(def.command, env, event, ctx, timeout);
    }
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
        const input = def.jsonIO ? JSON.stringify({ event, ...ctx }) : undefined;
        const result = spawnSync(def.command, {
          shell: true,
          timeout: def.timeout ?? 10_000,
          stdio: "pipe",
          env,
          input,
        });
        if (result.status !== 0 || result.error) return false;
        // JSON mode: parse stdout for {decision: "deny"} → block. Allow on empty
        // stdout (exit-code already gated above). Malformed JSON fails closed.
        if (def.jsonIO) {
          const out = result.stdout?.toString() ?? "";
          if (out.trim()) {
            try {
              const parsed = JSON.parse(out) as { decision?: string };
              if (parsed.decision === "deny") return false;
            } catch {
              return false;
            }
          }
        }
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

// ── Structured-outcome hook emitter (Task 2) ──

/** Parsed shape of a jsonIO hook's stdout JSON response. */
export type ParsedJsonIoResponse = {
  decision?: "allow" | "deny";
  reason?: string;
  additionalContext?: string;
  permissionDecision?: "allow" | "deny" | "ask";
};

/** Parse a hook's stdout as a jsonIO envelope. Returns an empty object on malformed input. */
export function parseJsonIoResponse(raw: string): ParsedJsonIoResponse {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const rec = obj as Record<string, unknown>;
  const out: ParsedJsonIoResponse = {};
  if (rec.decision === "allow" || rec.decision === "deny") out.decision = rec.decision;
  if (typeof rec.reason === "string") out.reason = rec.reason;
  const hso = rec.hookSpecificOutput;
  if (hso && typeof hso === "object" && !Array.isArray(hso)) {
    const hsoRec = hso as Record<string, unknown>;
    if (typeof hsoRec.additionalContext === "string") out.additionalContext = hsoRec.additionalContext;
    if (hsoRec.decision === "allow" || hsoRec.decision === "deny" || hsoRec.decision === "ask") {
      out.permissionDecision = hsoRec.decision;
    }
    if (typeof hsoRec.reason === "string" && !out.reason) out.reason = hsoRec.reason;
  }
  return out;
}

export type HookOutcome = {
  allowed: boolean;
  additionalContext?: string;
  permissionDecision?: "allow" | "deny" | "ask";
  reason?: string;
};

/** Events for which "notify-only" semantics apply — outcome.allowed is always true. */
const NOTIFY_ONLY_OUTCOME_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>(["postToolUseFailure"]);

/**
 * Execute a single hook definition and return a ParsedJsonIoResponse for outcome merging.
 * Private to this module — not exported.
 */
async function runHookForOutcome(def: HookDef, event: HookEvent, ctx: HookContext): Promise<ParsedJsonIoResponse> {
  if (def.jsonIO && def.command) {
    const env = buildEnv(event, ctx);
    let raw: string;
    try {
      raw = await runJsonIoHookCaptureStdout(def.command, env, event, ctx, def.timeout ?? 10_000);
    } catch {
      // timeout, spawn error, non-zero exit — treat as deny for gating events
      return { decision: "deny", reason: "hook failed (timeout or non-zero exit)" };
    }
    if (!raw.trim()) {
      // empty stdout with exit 0 — treat as allow (no decision)
      return {};
    }
    return parseJsonIoResponse(raw);
  }

  if (def.command) {
    // env-var mode — gate on exit code
    const env = buildEnv(event, ctx);
    const code = await runCommandHookAsync(def.command, env, def.timeout ?? 10_000);
    return code === 0 ? {} : { decision: "deny", reason: "hook denied (non-zero exit)" };
  }

  if (def.http) {
    const allowed = await runHttpHook(def.http, event, ctx, def.timeout ?? 10_000);
    return allowed ? {} : { decision: "deny", reason: "http hook denied" };
  }

  if (def.prompt) {
    const allowed = await runPromptHook(def.prompt, ctx, def.timeout ?? 10_000);
    return allowed ? {} : { decision: "deny", reason: "prompt hook denied" };
  }

  return {};
}

/**
 * Emit a hook event and return a structured HookOutcome parsed from jsonIO responses.
 *
 * Merge semantics:
 * - First `deny` (or `permissionDecision: "deny"`) short-circuits: {allowed: false, ...}.
 * - `permissionDecision: "allow"` short-circuits: {allowed: true, permissionDecision: "allow"}.
 * - `additionalContext` from multiple hooks is concatenated in order, "\n\n" separated.
 * - For NOTIFY_ONLY_OUTCOME_EVENTS (postToolUseFailure), decision/permissionDecision
 *   from hooks is ignored — outcome.allowed is always true. additionalContext is still collected.
 */
export async function emitHookWithOutcome(event: HookEvent, ctx: HookContext = {}): Promise<HookOutcome> {
  const hooks = getHooks();
  const list = hooks?.[event];
  if (!list || list.length === 0) return { allowed: true };
  const notifyOnly = NOTIFY_ONLY_OUTCOME_EVENTS.has(event);

  const additionalContexts: string[] = [];
  let reason: string | undefined;
  let askSeen = false;

  for (const def of list) {
    if (def.match && !matchesHook(def, ctx)) continue;
    const parsed = await runHookForOutcome(def, event, ctx);

    if (!notifyOnly) {
      if (parsed.decision === "deny" || parsed.permissionDecision === "deny") {
        return {
          allowed: false,
          reason: parsed.reason ?? reason,
          permissionDecision: parsed.permissionDecision,
        };
      }
      if (parsed.permissionDecision === "allow") {
        if (parsed.additionalContext) additionalContexts.push(parsed.additionalContext);
        return {
          allowed: true,
          permissionDecision: "allow",
          additionalContext: additionalContexts.length ? additionalContexts.join("\n\n") : undefined,
        };
      }
      if (parsed.permissionDecision === "ask") askSeen = true;
    }
    if (parsed.additionalContext) additionalContexts.push(parsed.additionalContext);
    if (!reason && parsed.reason) reason = parsed.reason;
  }

  return {
    allowed: true,
    additionalContext: additionalContexts.length ? additionalContexts.join("\n\n") : undefined,
    permissionDecision: askSeen ? "ask" : undefined,
    reason,
  };
}
