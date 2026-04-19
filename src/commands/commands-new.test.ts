/**
 * Tests for new slash commands: /doctor, /context, /mcp, /keys, /fast, /pin, /unpin, /router
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invalidateConfigCache } from "../harness/config.js";
import { recordRouteSelection } from "../providers/router.js";
import { createAssistantMessage, createUserMessage } from "../types/message.js";
import { type CommandContext, processSlashCommand } from "./index.js";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    messages: [],
    model: "gpt-4o",
    providerName: "openai",
    permissionMode: "ask",
    totalCost: 0.05,
    totalInputTokens: 2000,
    totalOutputTokens: 1000,
    sessionId: "test-sess-123",
    ...overrides,
  };
}

// ── /doctor ──

test("/doctor shows diagnostic info", async () => {
  const result = await processSlashCommand("/doctor", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Provider"));
  assert.ok(result.output.includes("openai"));
  assert.ok(result.output.includes("Model"));
  assert.ok(result.output.includes("gpt-4o"));
  assert.ok(result.output.includes("Session"));
});

// ── /context ──

test("/context shows context window breakdown", async () => {
  const msgs = [createUserMessage("What is 2+2?"), createAssistantMessage("2+2 = 4"), createUserMessage("Thanks")];
  const result = await processSlashCommand("/context", makeCtx({ messages: msgs }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Context Window"));
  assert.ok(result.output.includes("tokens"));
  assert.ok(result.output.includes("User messages"));
  assert.ok(result.output.includes("Assistant"));
  assert.ok(result.output.includes("Free"));
});

test("/context with empty messages", async () => {
  const result = await processSlashCommand("/context", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Context Window"));
  assert.ok(result.output.includes("Messages: 0"));
});

// ── /mcp ──

test("/mcp shows no servers message when none connected", async () => {
  const result = await processSlashCommand("/mcp", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No MCP") || result.output.includes("MCP"));
});

// ── /keys ──

test("/keys shows keyboard shortcuts", async () => {
  const result = await processSlashCommand("/keys", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Keyboard Shortcuts"));
  assert.ok(result.output.includes("Navigation"));
  assert.ok(result.output.includes("Ctrl+K"));
  assert.ok(result.output.includes("Ctrl+O"));
  assert.ok(result.output.includes("Scroll wheel"));
});

test("/keys includes custom keybindings section", async () => {
  const result = await processSlashCommand("/keys", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("keybindings"));
  // Default bindings should appear
  assert.ok(result.output.includes("/diff"));
});

// ── /fast ──

test("/fast returns toggleFastMode", async () => {
  const result = await processSlashCommand("/fast", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.toggleFastMode, true);
});

// ── /pin ──

test("/pin with valid index returns compactedMessages with pinned flag", async () => {
  const msgs = [createUserMessage("hello"), createAssistantMessage("world")];
  const result = await processSlashCommand("/pin 1", makeCtx({ messages: msgs }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("pinned"));
  assert.ok(result.compactedMessages);
  assert.equal(result.compactedMessages!.length, 2);
  assert.equal((result.compactedMessages![0] as any).meta?.pinned, true);
  assert.equal((result.compactedMessages![1] as any).meta?.pinned, undefined);
});

test("/pin with out-of-range index shows usage", async () => {
  const result = await processSlashCommand("/pin 99", makeCtx({ messages: [createUserMessage("x")] }));
  assert.ok(result);
  assert.ok(result.output.includes("Usage"));
});

test("/pin without args shows usage", async () => {
  const result = await processSlashCommand("/pin", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Usage"));
});

// ── /unpin ──

test("/unpin removes pinned flag", async () => {
  const msgs = [createUserMessage("hello"), createAssistantMessage("world")];
  // Pin first, then unpin
  const pinResult = await processSlashCommand("/pin 1", makeCtx({ messages: msgs }));
  const pinnedMsgs = pinResult!.compactedMessages!;
  const unpinResult = await processSlashCommand("/unpin 1", makeCtx({ messages: pinnedMsgs }));
  assert.ok(unpinResult);
  assert.ok(unpinResult.output.includes("unpinned"));
  assert.equal((unpinResult.compactedMessages![0] as any).meta?.pinned, false);
});

// ── aliases ──

test("/s alias maps to /status", async () => {
  const result = await processSlashCommand("/s", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Model"));
});

test("/h alias maps to /help", async () => {
  const result = await processSlashCommand("/h", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Session"));
  assert.ok(result.output.includes("Git"));
});

// ── /loop ──

test("/loop with no args shows usage", async () => {
  const result = await processSlashCommand("/loop", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/loop with dynamic prompt returns prependToPrompt", async () => {
  const result = await processSlashCommand("/loop check if CI passed", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.output.includes("Dynamic"));
  assert.ok(result.prependToPrompt?.includes("LOOP MODE"));
  assert.ok(result.prependToPrompt?.includes("ScheduleWakeup"));
  assert.ok(result.prependToPrompt?.includes("check if CI passed"));
});

test("/loop with fixed interval parses correctly", async () => {
  const result = await processSlashCommand("/loop 5m /review", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.output.includes("Fixed interval"));
  assert.ok(result.prependToPrompt?.includes("300"));
  assert.ok(result.prependToPrompt?.includes("/review"));
});

// ── /plan ──

test("/plan instructs to use EnterPlanMode tool", async () => {
  const result = await processSlashCommand("/plan build auth system", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("EnterPlanMode"));
  assert.ok(result.prependToPrompt?.includes("ExitPlanMode"));
  assert.ok(result.prependToPrompt?.includes("build auth system"));
});

// ── /init ──

test("/init returns handled result", async () => {
  const result = await processSlashCommand("/init", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  // Either "already exists" (local dev) or "Initialized" (CI) — both valid
  assert.ok(
    result.output.includes("already") || result.output.includes("Initialized") || result.output.includes(".oh"),
  );
});

// ── /permissions ──

test("/permissions with no args shows current mode", async () => {
  const result = await processSlashCommand("/permissions", makeCtx({ permissionMode: "trust" }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("trust"));
  assert.ok(result.output.includes("Available modes"));
});

test("/permissions with valid mode sets it", async () => {
  const result = await processSlashCommand("/permissions deny", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("deny"));
});

test("/permissions with invalid mode shows error", async () => {
  const result = await processSlashCommand("/permissions yolo", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Unknown mode"));
});

// ── /allowed-tools ──

test("/allowed-tools shows no rules message when none configured", async () => {
  const result = await processSlashCommand("/allowed-tools", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No custom tool permission rules") || result.output.includes("toolPermissions"));
});

// ── /router ──

function makeTmpDir(): string {
  const dir = join(tmpdir(), `oh-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runRouter(opts: {
  routerCfg?: { fast?: string; balanced?: string; powerful?: string };
  sessionId?: string;
  withLastSelection?: { tier: "fast" | "balanced" | "powerful"; model: string; reason: string };
}): Promise<string> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    mkdirSync(join(dir, ".oh"), { recursive: true });
    const lines = ["provider: mock", "model: DEFAULT_MODEL", "permissionMode: trust"];
    if (opts.routerCfg && Object.values(opts.routerCfg).some(Boolean)) {
      lines.push("modelRouter:");
      for (const [k, v] of Object.entries(opts.routerCfg)) {
        if (v) lines.push(`  ${k}: ${v}`);
      }
    }
    lines.push("");
    writeFileSync(join(dir, ".oh", "config.yaml"), lines.join("\n"));
    invalidateConfigCache();

    if (opts.withLastSelection && opts.sessionId) {
      recordRouteSelection(opts.sessionId, opts.withLastSelection);
    }

    const ctx = makeCtx({
      model: "DEFAULT_MODEL",
      sessionId: opts.sessionId ?? "router-test-no-session",
    });
    const result = await processSlashCommand("/router", ctx);
    assert.ok(result, "/router should be handled");
    return result!.output;
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

test("/router reports 'off' when no modelRouter config is set", async () => {
  const out = await runRouter({});
  assert.match(out, /Router:\s*off/i);
  assert.match(out, /DEFAULT_MODEL/);
});

test("/router lists all three tiers when configured", async () => {
  const out = await runRouter({
    routerCfg: { fast: "F_MODEL", balanced: "B_MODEL", powerful: "P_MODEL" },
  });
  assert.match(out, /fast/i);
  assert.match(out, /F_MODEL/);
  assert.match(out, /balanced/i);
  assert.match(out, /B_MODEL/);
  assert.match(out, /powerful/i);
  assert.match(out, /P_MODEL/);
});

test("/router shows last selection when recorded for the session", async () => {
  const out = await runRouter({
    routerCfg: { fast: "F_MODEL" },
    sessionId: "router-cmd-test-sel",
    withLastSelection: { tier: "fast", model: "F_MODEL", reason: "tool-heavy turn" },
  });
  assert.match(out, /Last selection:\s*fast/i);
  assert.match(out, /tool-heavy turn/);
});

test("/router does NOT show last selection when no prior selection recorded", async () => {
  const out = await runRouter({
    routerCfg: { balanced: "B_MODEL" },
    sessionId: "router-cmd-test-none",
  });
  assert.doesNotMatch(out, /Last selection:/);
});
