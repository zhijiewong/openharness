import assert from "node:assert";
import { describe, it } from "node:test";
import { CostTracker } from "./cost.js";
import { handleUserInput, type SubmitContext } from "./submit-handler.js";

function makeCtx(overrides?: Partial<SubmitContext>): SubmitContext {
  return {
    messages: [],
    currentModel: "claude-sonnet-4-6",
    providerName: "anthropic",
    permissionMode: "ask",
    cost: new CostTracker(),
    sessionId: "test-session",
    companionConfig: null,
    ...overrides,
  };
}

describe("handleUserInput", () => {
  it("vim toggle returns vimToggled=true", async () => {
    const result = await handleUserInput("/vim", makeCtx());
    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.vimToggled, true);
  });

  it("/help returns handled=true with output in messages", async () => {
    const result = await handleUserInput("/help", makeCtx());
    assert.strictEqual(result.handled, true);
    // /help produces info message appended to messages
    assert.ok(result.messages.length > 0);
    const lastMsg = result.messages[result.messages.length - 1]!;
    assert.ok(lastMsg.content.includes("/help"));
  });

  it("/clear returns handled=true and clears messages", async () => {
    const ctx = makeCtx({
      messages: [
        { role: "user", content: "hello", uuid: "u1", timestamp: 1 },
        { role: "assistant", content: "hi", uuid: "u2", timestamp: 2 },
      ],
    });
    const result = await handleUserInput("/clear", ctx);
    assert.strictEqual(result.handled, true);
    // After clear, info message is added to empty array
    // The clearMessages flag causes messages to be [] first, then info message added
    const hasCleared = result.messages.length <= 1; // at most the info message
    assert.ok(hasCleared);
  });

  it("normal text adds user message and returns prompt", async () => {
    const result = await handleUserInput("Hello, world!", makeCtx());
    assert.strictEqual(result.handled, false);
    assert.ok(result.prompt !== undefined);
    assert.ok(result.prompt!.includes("Hello, world!"));
    // User message should be appended
    const userMsgs = result.messages.filter((m) => m.role === "user");
    assert.ok(userMsgs.length > 0);
    assert.strictEqual(userMsgs[userMsgs.length - 1]!.content, "Hello, world!");
  });

  it("unknown slash command returns handled=true with error output", async () => {
    const result = await handleUserInput("/nonexistent", makeCtx());
    assert.strictEqual(result.handled, true);
    const lastMsg = result.messages[result.messages.length - 1]!;
    assert.ok(lastMsg.content.includes("Unknown command"));
  });
});
