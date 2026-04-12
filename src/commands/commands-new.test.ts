/**
 * Tests for new slash commands: /doctor, /context, /mcp, /keys, /fast, /pin, /unpin
 */

import assert from "node:assert/strict";
import test from "node:test";
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

test("/doctor shows diagnostic info", () => {
  const result = processSlashCommand("/doctor", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Provider"));
  assert.ok(result.output.includes("openai"));
  assert.ok(result.output.includes("Model"));
  assert.ok(result.output.includes("gpt-4o"));
  assert.ok(result.output.includes("Session"));
});

// ── /context ──

test("/context shows context window breakdown", () => {
  const msgs = [createUserMessage("What is 2+2?"), createAssistantMessage("2+2 = 4"), createUserMessage("Thanks")];
  const result = processSlashCommand("/context", makeCtx({ messages: msgs }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Context Window"));
  assert.ok(result.output.includes("tokens"));
  assert.ok(result.output.includes("User messages"));
  assert.ok(result.output.includes("Assistant"));
  assert.ok(result.output.includes("Free"));
});

test("/context with empty messages", () => {
  const result = processSlashCommand("/context", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Context Window"));
  assert.ok(result.output.includes("Messages: 0"));
});

// ── /mcp ──

test("/mcp shows no servers message when none connected", () => {
  const result = processSlashCommand("/mcp", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No MCP") || result.output.includes("MCP"));
});

// ── /keys ──

test("/keys shows keyboard shortcuts", () => {
  const result = processSlashCommand("/keys", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Keyboard Shortcuts"));
  assert.ok(result.output.includes("Navigation"));
  assert.ok(result.output.includes("Ctrl+K"));
  assert.ok(result.output.includes("Ctrl+O"));
  assert.ok(result.output.includes("Scroll wheel"));
});

test("/keys includes custom keybindings section", () => {
  const result = processSlashCommand("/keys", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("keybindings"));
  // Default bindings should appear
  assert.ok(result.output.includes("/diff"));
});

// ── /fast ──

test("/fast returns toggleFastMode", () => {
  const result = processSlashCommand("/fast", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.toggleFastMode, true);
});

// ── /pin ──

test("/pin with valid index returns compactedMessages with pinned flag", () => {
  const msgs = [createUserMessage("hello"), createAssistantMessage("world")];
  const result = processSlashCommand("/pin 1", makeCtx({ messages: msgs }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("pinned"));
  assert.ok(result.compactedMessages);
  assert.equal(result.compactedMessages!.length, 2);
  assert.equal((result.compactedMessages![0] as any).meta?.pinned, true);
  assert.equal((result.compactedMessages![1] as any).meta?.pinned, undefined);
});

test("/pin with out-of-range index shows usage", () => {
  const result = processSlashCommand("/pin 99", makeCtx({ messages: [createUserMessage("x")] }));
  assert.ok(result);
  assert.ok(result.output.includes("Usage"));
});

test("/pin without args shows usage", () => {
  const result = processSlashCommand("/pin", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Usage"));
});

// ── /unpin ──

test("/unpin removes pinned flag", () => {
  const msgs = [createUserMessage("hello"), createAssistantMessage("world")];
  // Pin first, then unpin
  const pinResult = processSlashCommand("/pin 1", makeCtx({ messages: msgs }));
  const pinnedMsgs = pinResult!.compactedMessages!;
  const unpinResult = processSlashCommand("/unpin 1", makeCtx({ messages: pinnedMsgs }));
  assert.ok(unpinResult);
  assert.ok(unpinResult.output.includes("unpinned"));
  assert.equal((unpinResult.compactedMessages![0] as any).meta?.pinned, false);
});

// ── aliases ──

test("/s alias maps to /status", () => {
  const result = processSlashCommand("/s", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Model"));
});

test("/h alias maps to /help", () => {
  const result = processSlashCommand("/h", makeCtx());
  assert.ok(result);
  assert.ok(result.output.includes("Session"));
  assert.ok(result.output.includes("Git"));
});

// ── /loop ──

test("/loop with no args shows usage", () => {
  const result = processSlashCommand("/loop", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/loop with dynamic prompt returns prependToPrompt", () => {
  const result = processSlashCommand("/loop check if CI passed", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.output.includes("Dynamic"));
  assert.ok(result.prependToPrompt?.includes("LOOP MODE"));
  assert.ok(result.prependToPrompt?.includes("ScheduleWakeup"));
  assert.ok(result.prependToPrompt?.includes("check if CI passed"));
});

test("/loop with fixed interval parses correctly", () => {
  const result = processSlashCommand("/loop 5m /review", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.output.includes("Fixed interval"));
  assert.ok(result.prependToPrompt?.includes("300"));
  assert.ok(result.prependToPrompt?.includes("/review"));
});

// ── /plan ──

test("/plan instructs to use EnterPlanMode tool", () => {
  const result = processSlashCommand("/plan build auth system", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("EnterPlanMode"));
  assert.ok(result.prependToPrompt?.includes("ExitPlanMode"));
  assert.ok(result.prependToPrompt?.includes("build auth system"));
});

// ── /init ──

test("/init shows usage when .oh already exists", () => {
  // When run from this repo, .oh/ exists
  const result = processSlashCommand("/init", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("already"));
});

// ── /permissions ──

test("/permissions with no args shows current mode", () => {
  const result = processSlashCommand("/permissions", makeCtx({ permissionMode: "trust" }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("trust"));
  assert.ok(result.output.includes("Available modes"));
});

test("/permissions with valid mode sets it", () => {
  const result = processSlashCommand("/permissions deny", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("deny"));
});

test("/permissions with invalid mode shows error", () => {
  const result = processSlashCommand("/permissions yolo", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Unknown mode"));
});

// ── /allowed-tools ──

test("/allowed-tools shows no rules message when none configured", () => {
  const result = processSlashCommand("/allowed-tools", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No custom tool permission rules") || result.output.includes("toolPermissions"));
});
