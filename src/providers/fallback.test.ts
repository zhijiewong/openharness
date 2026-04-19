import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StreamEvent } from "../types/events.js";
import type { Message } from "../types/message.js";
import type { ModelInfo, Provider } from "./base.js";
import { createFallbackProvider } from "./fallback.js";

/** Build a minimal fake Provider. Pass opts to customize stream/complete behavior. */
function fakeProvider(opts: {
  name: string;
  streamEvents?: StreamEvent[];
  streamError?: Error;
  streamErrorAfterEvents?: number;
  completeResult?: Message;
  completeError?: Error;
}): Provider {
  return {
    name: opts.name,
    async *stream(_messages, _systemPrompt, _tools, _model) {
      if (opts.streamErrorAfterEvents !== undefined) {
        const events = opts.streamEvents ?? [];
        for (let i = 0; i < Math.min(events.length, opts.streamErrorAfterEvents); i++) {
          yield events[i]!;
        }
        throw opts.streamError ?? new Error("mid-stream error");
      }
      if (opts.streamError) throw opts.streamError;
      for (const e of opts.streamEvents ?? []) yield e;
    },
    async complete(_messages, _systemPrompt, _tools, _model) {
      if (opts.completeError) throw opts.completeError;
      return (
        opts.completeResult ?? {
          role: "assistant" as const,
          content: "",
          uuid: "fake-uuid",
          timestamp: 0,
        }
      );
    },
    listModels(): ModelInfo[] {
      return [];
    },
    async healthCheck() {
      return !opts.streamError && !opts.completeError;
    },
  } as Provider;
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("createFallbackProvider — stream()", () => {
  it("primary succeeds → no fallback; events from primary only", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
    });
    const fallback = fakeProvider({ name: "fb1" });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string; content: string }).content, "ok");
    assert.equal(wrapped.activeFallback, null);
  });

  it("primary fails pre-stream with 429 → falls to first fallback", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamError: new Error("429 Too Many Requests"),
    });
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "from fb1" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string; content: string }).content, "from fb1");
    assert.equal(wrapped.activeFallback, "fb1");
  });

  it("primary fails with 401 → propagates, no fallback attempted", async () => {
    const primary = fakeProvider({
      name: "primary",
      streamError: new Error("401 Unauthorized"),
    });
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "SHOULD NOT RUN" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    await assert.rejects(() => drain(wrapped.stream([], "sys", [], "m")), /401 Unauthorized/);
  });

  it("primary fails mid-stream with retriable error → error propagates (no fallback)", async () => {
    // Retriable error mid-stream: hasYielded=true forces rethrow even though it's retriable.
    // This validates Fix 1: the catch block now checks hasYielded before deciding to fall back.
    // The fallback provider would yield different content — receiving only the partial
    // primary event confirms the fallback was NOT invoked.
    const primary = fakeProvider({
      name: "primary",
      streamEvents: [{ type: "text_delta", content: "partial" } as StreamEvent],
      streamError: new Error("429 mid-stream rate limit"),
      streamErrorAfterEvents: 1,
    });
    const fallback = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "FALLBACK SHOULD NOT RUN" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const events: StreamEvent[] = [];
    let thrown: Error | undefined;
    try {
      for await (const e of wrapped.stream([], "sys", [], "m")) {
        events.push(e as StreamEvent);
      }
      assert.fail("expected mid-stream error to throw");
    } catch (err) {
      thrown = err as Error;
    }
    assert.ok(thrown, "expected an error to be thrown");
    assert.match(thrown.message, /mid-stream/i);
    // Exactly 1 event was yielded before the error (the "partial" event from primary)
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string; content: string }).content, "partial");
  });

  it("primary fails retriable, second fallback succeeds → events from second fallback", async () => {
    // When primary fails retriably (i===0), the chain advances to fb1.
    // fb1 succeeds, so fb2 is never needed.
    const primary = fakeProvider({ name: "primary", streamError: new Error("503 Service Unavailable") });
    const fb1 = fakeProvider({
      name: "fb1",
      streamEvents: [{ type: "text_delta", content: "from fb1" } as StreamEvent],
    });
    const fb2 = fakeProvider({
      name: "fb2",
      streamEvents: [{ type: "text_delta", content: "SHOULD NOT RUN" } as StreamEvent],
    });
    const wrapped = createFallbackProvider(primary, [{ provider: fb1 }, { provider: fb2 }]);

    const events = await drain(wrapped.stream([], "sys", [], "m"));
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string; content: string }).content, "from fb1");
    assert.equal(wrapped.activeFallback, "fb1");
  });

  it("primary alone fails retriable with no fallbacks → throws 'All providers failed'", async () => {
    // With no fallbacks, the loop exits normally after primary's retriable failure,
    // and the post-loop sentinel throws "All providers failed".
    const primary = fakeProvider({ name: "primary", streamError: new Error("429") });
    const wrapped = createFallbackProvider(primary, []);

    await assert.rejects(() => drain(wrapped.stream([], "sys", [], "m")), /All providers failed/);
  });
});

describe("createFallbackProvider — complete()", () => {
  it("primary fails retriable → fallback.complete() result returned", async () => {
    const primary = fakeProvider({ name: "primary", completeError: new Error("429") });
    const fbResult: Message = {
      role: "assistant",
      content: "from fb",
      uuid: "test-uuid",
      timestamp: 0,
    };
    const fallback = fakeProvider({ name: "fb1", completeResult: fbResult });
    const wrapped = createFallbackProvider(primary, [{ provider: fallback }]);

    const result = await wrapped.complete([], "sys", [], "m");
    assert.equal(result.content, "from fb");
    assert.equal(wrapped.activeFallback, "fb1");
  });
});

describe("createFallbackProvider — observability", () => {
  it("emits console.warn when a fallback activates on stream()", async () => {
    const original = console.warn;
    const warns: string[] = [];
    console.warn = (msg: string) => {
      warns.push(String(msg));
    };
    try {
      const primary = fakeProvider({ name: "primary", streamError: new Error("429") });
      const fb1 = fakeProvider({
        name: "fb1",
        streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
      });
      const wrapped = createFallbackProvider(primary, [{ provider: fb1 }]);
      await drain(wrapped.stream([], "sys", [], "m"));
      assert.equal(warns.length, 1);
      assert.match(warns[0]!, /fell back from primary to fb1/i);
    } finally {
      console.warn = original;
    }
  });

  it("does NOT emit console.warn when primary succeeds", async () => {
    const original = console.warn;
    const warns: string[] = [];
    console.warn = (msg: string) => {
      warns.push(String(msg));
    };
    try {
      const primary = fakeProvider({
        name: "primary",
        streamEvents: [{ type: "text_delta", content: "ok" } as StreamEvent],
      });
      const fb1 = fakeProvider({ name: "fb1" });
      const wrapped = createFallbackProvider(primary, [{ provider: fb1 }]);
      await drain(wrapped.stream([], "sys", [], "m"));
      assert.equal(warns.length, 0);
    } finally {
      console.warn = original;
    }
  });
});
