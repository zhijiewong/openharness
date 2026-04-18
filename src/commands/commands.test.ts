import assert from "node:assert/strict";
import test from "node:test";
import { type CommandContext, processSlashCommand } from "./index.js";

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

test("returns null for non-slash input", async () => {
  const result = await processSlashCommand("hello", makeCtx());
  assert.equal(result, null);
});

test("/help returns output with command names and handled=true", async () => {
  const result = await processSlashCommand("/help", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("help"));
  assert.ok(result.output.includes("clear"));
  assert.ok(result.output.includes("cost"));
});

test("/clear sets clearMessages=true", async () => {
  const result = await processSlashCommand("/clear", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.clearMessages, true);
});

test("/cost returns output with cost and token info", async () => {
  const result = await processSlashCommand("/cost", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("0.0042"));
  assert.ok(result.output.includes("1,000"));
});

test("/status returns output with model and provider info", async () => {
  const result = await processSlashCommand("/status", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("gpt-4o"));
  assert.ok(result.output.includes("default"));
});

test("/model newmodel sets newModel in result", async () => {
  const result = await processSlashCommand("/model newmodel", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.newModel, "newmodel");
});

test("/export returns output", async () => {
  const result = await processSlashCommand("/export", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.length > 0);
});

test("unknown /xyz returns output containing 'Unknown'", async () => {
  const result = await processSlashCommand("/xyz", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Unknown"));
});

// ── New commands ──

test("/fast sets toggleFastMode", async () => {
  const result = await processSlashCommand("/fast", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.equal(result.toggleFastMode, true);
});

test("/pin without args shows usage", async () => {
  const result = await processSlashCommand("/pin", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/pin with valid index succeeds and returns updated messages", async () => {
  const { createUserMessage } = await import("../types/message.js");
  const ctx = makeCtx({ messages: [createUserMessage("hello"), createUserMessage("world")] });
  const result = await processSlashCommand("/pin 1", ctx);
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("pinned"));
  assert.ok(result.compactedMessages);
  assert.equal(result.compactedMessages!.length, 2);
  assert.equal((result.compactedMessages![0] as any).meta?.pinned, true);
  assert.equal((result.compactedMessages![1] as any).meta?.pinned, undefined);
});

test("/unpin without args shows usage", async () => {
  const result = await processSlashCommand("/unpin", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});
