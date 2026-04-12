import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessage,
  createInfoMessage,
  createPinnedMessage,
  createToolResultMessage,
  createUserMessage,
} from "./message.js";

test("createUserMessage has role 'user', uuid, and timestamp", () => {
  const msg = createUserMessage("hello");
  assert.equal(msg.role, "user");
  assert.equal(msg.content, "hello");
  assert.equal(typeof msg.uuid, "string");
  assert.ok(msg.uuid.length > 0);
  assert.equal(typeof msg.timestamp, "number");
  assert.ok(msg.timestamp > 0);
});

test("createAssistantMessage has role 'assistant' and optional toolCalls", () => {
  const plain = createAssistantMessage("hi");
  assert.equal(plain.role, "assistant");
  assert.equal(plain.toolCalls, undefined);

  const withTools = createAssistantMessage("hi", [{ id: "c1", toolName: "Read", arguments: { path: "/tmp" } }]);
  assert.equal(withTools.role, "assistant");
  assert.equal(withTools.toolCalls!.length, 1);
  assert.equal(withTools.toolCalls![0]!.toolName, "Read");
});

test("createToolResultMessage has role 'tool' and toolResults array", () => {
  const msg = createToolResultMessage({
    callId: "c1",
    output: "done",
    isError: false,
  });
  assert.equal(msg.role, "tool");
  assert.ok(Array.isArray(msg.toolResults));
  assert.equal(msg.toolResults!.length, 1);
  assert.equal(msg.toolResults![0]!.callId, "c1");
});

test("createInfoMessage has meta.isInfo = true", () => {
  const msg = createInfoMessage("info text");
  assert.equal(msg.role, "system");
  assert.equal(msg.meta?.isInfo, true);
});

test("createPinnedMessage has meta.pinned = true AND meta.isInfo = true", () => {
  const msg = createPinnedMessage("pinned text");
  assert.equal(msg.role, "system");
  assert.equal(msg.meta?.pinned, true);
  assert.equal(msg.meta?.isInfo, true);
});
