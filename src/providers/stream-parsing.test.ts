/**
 * Tests for provider stream parsing — Anthropic and OpenAI SSE event handling.
 * Mocks fetch() to return controlled SSE streams and verifies parsed events.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { StreamEvent } from "../types/events.js";
import { createUserMessage } from "../types/message.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

const originalFetch = globalThis.fetch;

function mockSSE(lines: string[]): () => void {
  const body = `${lines.join("\n")}\n`;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  })) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("Anthropic stream parsing", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it("parses text_delta events", async () => {
    cleanup = mockSSE([
      "event: content_block_start",
      'data: {"content_block":{"type":"text"}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"text_delta","text":"Hello "}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"text_delta","text":"world"}}',
      "event: content_block_stop",
      "data: {}",
      "event: message_delta",
      'data: {"usage":{"output_tokens":10}}',
      "event: message_stop",
      "data: {}",
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const textEvents = events.filter((e) => e.type === "text_delta");
    assert.equal(textEvents.length, 2);
    assert.equal((textEvents[0] as any).content, "Hello ");
    assert.equal((textEvents[1] as any).content, "world");
  });

  it("parses tool_call events with JSON accumulation", async () => {
    cleanup = mockSSE([
      "event: content_block_start",
      'data: {"content_block":{"type":"tool_use","id":"tc1","name":"Bash"}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"input_json_delta","partial_json":"{\\"com"}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"input_json_delta","partial_json":"mand\\":\\"echo hi\\"}"}}',
      "event: content_block_stop",
      "data: {}",
      "event: message_stop",
      "data: {}",
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const starts = events.filter((e) => e.type === "tool_call_start");
    const completes = events.filter((e) => e.type === "tool_call_complete");
    assert.equal(starts.length, 1);
    assert.equal((starts[0] as any).toolName, "Bash");
    assert.equal(completes.length, 1);
    assert.deepEqual((completes[0] as any).arguments, { command: "echo hi" });
  });

  it("handles malformed tool args gracefully", async () => {
    cleanup = mockSSE([
      "event: content_block_start",
      'data: {"content_block":{"type":"tool_use","id":"tc1","name":"Bash"}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"input_json_delta","partial_json":"not valid json"}}',
      "event: content_block_stop",
      "data: {}",
      "event: message_stop",
      "data: {}",
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const errors = events.filter((e) => e.type === "error");
    assert.ok(errors.length > 0, "Should yield error for malformed JSON");
    assert.ok((errors[0] as any).message.includes("Malformed"));
  });

  it("parses thinking_delta events", async () => {
    cleanup = mockSSE([
      "event: content_block_start",
      'data: {"content_block":{"type":"thinking"}}',
      "event: content_block_delta",
      'data: {"delta":{"type":"thinking_delta","thinking":"Let me think..."}}',
      "event: content_block_stop",
      "data: {}",
      "event: message_stop",
      "data: {}",
    ]);
    const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const thinking = events.filter((e) => e.type === "thinking_delta");
    assert.equal(thinking.length, 1);
    assert.equal((thinking[0] as any).content, "Let me think...");
  });

  it("yields error on HTTP failure", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })) as any;
    cleanup = () => {
      globalThis.fetch = originalFetch;
    };
    const provider = new AnthropicProvider({ name: "anthropic", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const errors = events.filter((e) => e.type === "error");
    assert.ok(errors.length > 0);
    assert.ok((errors[0] as any).message.includes("500"));
  });
});

describe("OpenAI stream parsing", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  it("parses text content deltas", async () => {
    cleanup = mockSSE([
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"},"index":0}]}',
      'data: {"choices":[{"delta":{"content":" there"},"index":0}]}',
      "data: [DONE]",
    ]);
    const provider = new OpenAIProvider({ name: "openai", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const textEvents = events.filter((e) => e.type === "text_delta");
    assert.ok(textEvents.length >= 1);
  });

  it("parses tool call with function arguments", async () => {
    cleanup = mockSSE([
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc1","type":"function","function":{"name":"Read","arguments":""}}]},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file_"}}]},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"path\\":\\"test.ts\\"}"}}]},"index":0}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}',
      "data: [DONE]",
    ]);
    const provider = new OpenAIProvider({ name: "openai", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const completes = events.filter((e) => e.type === "tool_call_complete");
    assert.equal(completes.length, 1);
    assert.equal((completes[0] as any).toolName, "Read");
  });

  it("yields error on HTTP failure", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    })) as any;
    cleanup = () => {
      globalThis.fetch = originalFetch;
    };
    const provider = new OpenAIProvider({ name: "openai", apiKey: "test" });
    const events = await collectEvents(provider.stream([createUserMessage("hi")], "system"));
    const errors = events.filter((e) => e.type === "error");
    assert.ok(errors.length > 0);
  });
});
