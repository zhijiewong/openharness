import test from "node:test";
import assert from "node:assert/strict";
import { processSlashCommand, type CommandContext } from "./index.js";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    messages: [],
    model: "gpt-4o",
    providerName: "openai",
    permissionMode: "default",
    totalCost: 0.0042,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    sessionId: "test-session-123",
    ...overrides,
  };
}

test("returns null for non-slash input", () => {
  const result = processSlashCommand("hello", makeCtx());
  assert.equal(result, null);
});

test("/help returns output with command names and handled=true", () => {
  const result = processSlashCommand("/help", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("help"));
  assert.ok(result.output.includes("clear"));
  assert.ok(result.output.includes("cost"));
});

test("/clear sets clearMessages=true", () => {
  const result = processSlashCommand("/clear", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.clearMessages, true);
});

test("/cost returns output with cost and token info", () => {
  const result = processSlashCommand("/cost", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("0.0042"));
  assert.ok(result.output.includes("1,000"));
});

test("/status returns output with model and provider info", () => {
  const result = processSlashCommand("/status", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("gpt-4o"));
  assert.ok(result.output.includes("default"));
});

test("/model newmodel sets newModel in result", () => {
  const result = processSlashCommand("/model newmodel", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.newModel, "newmodel");
});

test("/export returns output", () => {
  const result = processSlashCommand("/export", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.length > 0);
});

test("unknown /xyz returns output containing 'Unknown'", () => {
  const result = processSlashCommand("/xyz", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Unknown"));
});

// ── New commands ──

test("/fast sets toggleFastMode", () => {
  const result = processSlashCommand("/fast", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.toggleFastMode, true);
});

test("/pin without args shows usage", () => {
  const result = processSlashCommand("/pin", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/pin with valid index succeeds and returns updated messages", async () => {
  const { createUserMessage } = await import("../types/message.js");
  const ctx = makeCtx({ messages: [createUserMessage("hello"), createUserMessage("world")] });
  const result = processSlashCommand("/pin 1", ctx);
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("pinned"));
  assert.ok(result.compactedMessages);
  assert.equal(result.compactedMessages!.length, 2);
  assert.equal((result.compactedMessages![0] as any).meta?.pinned, true);
  assert.equal((result.compactedMessages![1] as any).meta?.pinned, undefined);
});

test("/unpin without args shows usage", () => {
  const result = processSlashCommand("/unpin", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});
