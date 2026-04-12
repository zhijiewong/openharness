import assert from "node:assert";
import { describe, it } from "node:test";
import type { Message } from "../types/message.js";
import { createMessage } from "../types/message.js";
import { estimateMessageTokens, getContextWarning } from "./context-warning.js";

function msg(content: string, extra?: Partial<Pick<Message, "toolCalls" | "toolResults">>): Message {
  return createMessage("user", content, extra);
}

describe("estimateMessageTokens", () => {
  it("returns 0 for an empty messages array", () => {
    assert.strictEqual(estimateMessageTokens([]), 0);
  });

  it("estimates tokens as ~content.length / 3.5", () => {
    const content = "a".repeat(35); // 35 chars => ceil(35/3.5) = 10
    const result = estimateMessageTokens([msg(content)]);
    assert.strictEqual(result, Math.ceil(35 / 3.5));
  });

  it("adds tokens for toolCalls arguments", () => {
    const toolCalls = [{ id: "tc1", toolName: "bash", arguments: { command: "echo hello" } }] as const;
    const m = msg("hi", { toolCalls });
    const contentTokens = Math.ceil("hi".length / 3.5);
    const argsStr = JSON.stringify(toolCalls[0].arguments);
    const argsTokens = Math.ceil(argsStr.length / 3.5);
    assert.strictEqual(estimateMessageTokens([m]), contentTokens + argsTokens);
  });

  it("adds tokens for toolResults output", () => {
    const toolResults = [{ callId: "tc1", output: "some output text here", isError: false }] as const;
    const m = msg("hi", { toolResults });
    const contentTokens = Math.ceil("hi".length / 3.5);
    const resultTokens = Math.ceil("some output text here".length / 3.5);
    assert.strictEqual(estimateMessageTokens([m]), contentTokens + resultTokens);
  });

  it("skips messages before startFrom index", () => {
    const messages = [msg("a".repeat(100)), msg("b".repeat(50))];
    const allTokens = estimateMessageTokens(messages);
    const fromSecond = estimateMessageTokens(messages, 1);
    assert.strictEqual(fromSecond, Math.ceil(50 / 3.5));
    assert.ok(allTokens > fromSecond);
  });
});

describe("getContextWarning", () => {
  // claude- models have 200_000 context window
  const model = "claude-sonnet-4-6";
  const window = 200_000;

  it("returns null when usage is below 75%", () => {
    const tokens = Math.floor(window * 0.74);
    assert.strictEqual(getContextWarning(tokens, model), null);
  });

  it("returns a warning at 75% usage", () => {
    const tokens = Math.ceil(window * 0.75);
    const result = getContextWarning(tokens, model);
    assert.ok(result !== null);
    assert.strictEqual(result!.critical, false);
    assert.ok(result!.text.includes("Context"));
  });

  it("returns critical warning at 90%+ usage", () => {
    const tokens = Math.ceil(window * 0.92);
    const result = getContextWarning(tokens, model);
    assert.ok(result !== null);
    assert.strictEqual(result!.critical, true);
  });

  it("returns null for 0 tokens", () => {
    assert.strictEqual(getContextWarning(0, model), null);
  });
});
