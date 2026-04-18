import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { McpClient } from "./client.js";

/**
 * Minimal SDK-Client shape we rely on. Tests inject a fake instead of the
 * real SDK to keep unit tests hermetic.
 */
function fakeSdkClient(
  overrides: Partial<{
    listTools: () => Promise<{ tools: unknown[] }>;
    callTool: (req: {
      name: string;
      arguments: unknown;
    }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
    listResources: () => Promise<{ resources: unknown[] }>;
    readResource: (r: { uri: string }) => Promise<{ contents: Array<{ text?: string }> }>;
    getInstructions: () => string | undefined;
    close: () => Promise<void>;
  }> = {},
) {
  return {
    listTools: overrides.listTools ?? (async () => ({ tools: [] })),
    callTool: overrides.callTool ?? (async () => ({ content: [{ type: "text", text: "ok" }] })),
    listResources: overrides.listResources ?? (async () => ({ resources: [] })),
    readResource: overrides.readResource ?? (async (_r) => ({ contents: [{ text: "res" }] })),
    getInstructions: overrides.getInstructions ?? (() => undefined),
    close: overrides.close ?? (async () => {}),
  };
}

describe("McpClient wrapper", () => {
  it("callTool returns joined text content", async () => {
    const sdk = fakeSdkClient({
      callTool: async () => ({
        content: [
          { type: "text", text: "line1" },
          { type: "text", text: "line2" },
          { type: "image", text: "should-be-filtered" } as any,
        ],
      }),
    });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    const text = await client.callTool("foo", {});
    assert.equal(text, "line1\nline2");
  });

  it("callTool propagates application errors as thrown Error", async () => {
    const sdk = fakeSdkClient({
      callTool: async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
    });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    await assert.rejects(() => client.callTool("foo", {}), /boom/);
  });

  it("callTool retries once on transport-closed error and succeeds on retry", async () => {
    let calls = 0;
    const sdk = fakeSdkClient({
      callTool: async () => {
        calls++;
        if (calls === 1) throw new Error("transport closed");
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    let reconnectCount = 0;
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
      reconnect: async () => {
        reconnectCount++;
        return sdk as any;
      },
    });
    const text = await client.callTool("foo", {});
    assert.equal(text, "ok");
    assert.equal(calls, 2);
    assert.equal(reconnectCount, 1);
  });

  it("callTool does NOT retry on application errors", async () => {
    let calls = 0;
    const sdk = fakeSdkClient({
      callTool: async () => {
        calls++;
        return { content: [{ type: "text", text: "app err" }], isError: true };
      },
    });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    await assert.rejects(() => client.callTool("foo", {}), /app err/);
    assert.equal(calls, 1);
  });

  it("listTools maps SDK response to McpToolDef[]", async () => {
    const sdk = fakeSdkClient({
      listTools: async () => ({
        tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }],
      }),
    });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    const defs = await client.listTools();
    assert.equal(defs.length, 1);
    assert.equal(defs[0]!.name, "t1");
  });

  it("instructions field is populated from SDK getInstructions()", async () => {
    const sdk = fakeSdkClient({
      getInstructions: () => "follow these rules",
    });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    assert.equal(client.instructions, "follow these rules");
  });

  it("disconnect() calls SDK close()", async () => {
    const closeSpy = mock.fn(async () => {});
    const sdk = fakeSdkClient({ close: closeSpy });
    const client = McpClient._forTesting({
      name: "srv",
      cfg: { name: "srv", type: "stdio", command: "x" } as any,
      sdk: sdk as any,
      timeoutMs: 1000,
    });
    client.disconnect();
    await new Promise((r) => setImmediate(r));
    assert.equal(closeSpy.mock.callCount(), 1);
  });
});
