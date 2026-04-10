/**
 * Tests for Anthropic provider message conversion and tool formatting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "./anthropic.js";
import { createUserMessage, createAssistantMessage, createToolResultMessage } from "../types/message.js";

// Access private methods via prototype for testing
const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
const convertMessages = (provider as any).convertMessages.bind(provider);
const convertTools = (provider as any).convertTools.bind(provider);

// ── convertMessages ──

test("convertMessages() converts user message", () => {
  const msgs = [createUserMessage("hello")];
  const result = convertMessages(msgs);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { role: "user", content: "hello" });
});

test("convertMessages() converts assistant message", () => {
  const msgs = [createAssistantMessage("response text")];
  const result = convertMessages(msgs);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { role: "assistant", content: "response text" });
});

test("convertMessages() skips system messages", () => {
  const msgs = [
    { role: "system" as const, content: "system prompt", uuid: "1", timestamp: Date.now() },
    createUserMessage("hello"),
  ];
  const result = convertMessages(msgs);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { role: "user", content: "hello" });
});

test("convertMessages() converts assistant with tool calls", () => {
  // Create message with toolCalls via spread since it's readonly
  const base = createAssistantMessage("thinking...");
  const msg = {
    ...base,
    toolCalls: [{
      id: "tc1",
      toolName: "Bash",
      arguments: { command: "echo hi" },
    }],
  };
  const result = convertMessages([msg]);
  assert.equal(result.length, 1);
  const content = (result[0] as any).content;
  assert.equal(content.length, 2);
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "tool_use");
  assert.equal(content[1].name, "Bash");
});

test("convertMessages() converts tool result to user message", () => {
  const msg = createToolResultMessage({ callId: "tc1", output: "output text", isError: false });
  const result = convertMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal((result[0] as any).role, "user");
  const content = (result[0] as any).content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "tool_result");
  assert.equal(content[0].content, "output text");
});

// ── convertTools ──

test("convertTools() returns undefined for empty tools", () => {
  assert.equal(convertTools(undefined), undefined);
  assert.equal(convertTools([]), undefined);
});

test("convertTools() converts tool definitions", () => {
  const tools = [{
    type: "function" as const,
    function: {
      name: "Bash",
      description: "Run a command",
      parameters: { type: "object", properties: { command: { type: "string" } } },
    },
  }];
  const result = convertTools(tools);
  assert.ok(Array.isArray(result));
  assert.equal(result!.length, 1);
  assert.equal((result![0] as any).name, "Bash");
  assert.equal((result![0] as any).description, "Run a command");
});

// ── healthCheck ──

test("Anthropic healthCheck true with key, false without", async () => {
  const withKey = new AnthropicProvider({ name: "anthropic", apiKey: "sk-test" });
  assert.equal(await withKey.healthCheck(), true);
  const noKey = new AnthropicProvider({ name: "anthropic" });
  assert.equal(await noKey.healthCheck(), false);
});

// ── listModels ──

test("Anthropic listModels returns Claude models", () => {
  const p = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
  const models = p.listModels();
  assert.ok(models.length > 0);
  assert.ok(models.every(m => m.id.includes("claude")));
  assert.ok(models.every(m => m.provider === "anthropic"));
});
