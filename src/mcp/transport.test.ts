import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedConfig } from "./config-normalize.js";
import { buildTransport, ProtocolError, RemoteAuthRequiredError, UnreachableError } from "./transport.js";

describe("transport error types", () => {
  it("RemoteAuthRequiredError carries name, realm, and instance-of check", () => {
    const err = new RemoteAuthRequiredError("linear", 'Bearer realm="linear-mcp"');
    assert.ok(err instanceof RemoteAuthRequiredError);
    assert.ok(err instanceof Error);
    assert.equal(err.serverName, "linear");
    assert.equal(err.wwwAuthenticate, 'Bearer realm="linear-mcp"');
    assert.match(err.message, /linear/);
    assert.match(err.message, /OAuth flow is not yet supported/);
  });

  it("UnreachableError wraps cause", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new UnreachableError("api", cause);
    assert.ok(err instanceof UnreachableError);
    assert.match(err.message, /api/);
    assert.match(err.message, /ECONNREFUSED/);
  });

  it("ProtocolError wraps cause", () => {
    const err = new ProtocolError("svr", new Error("bad frame"));
    assert.ok(err instanceof ProtocolError);
    assert.match(err.message, /svr/);
    assert.match(err.message, /bad frame/);
  });
});

// Helper: fabricate a NormalizedConfig without going through normalizeMcpConfig
function stdio(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return { name: "test", type: "stdio", command: "echo", ...overrides } as NormalizedConfig;
}
function http(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return { name: "test", type: "http", url: "http://127.0.0.1:1/mcp", ...overrides } as NormalizedConfig;
}
function sse(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return { name: "test", type: "sse", url: "http://127.0.0.1:1/sse", ...overrides } as NormalizedConfig;
}

describe("buildTransport dispatch", () => {
  it("stdio config produces a StdioClientTransport-shaped object (has start/close)", async () => {
    const t = await buildTransport(stdio());
    assert.equal(typeof (t as any).start, "function");
    assert.equal(typeof (t as any).close, "function");
    // Don't actually start it — echo would exit immediately; shape check is enough.
  });

  it("http config produces a StreamableHTTP transport", async () => {
    const t = await buildTransport(http());
    assert.equal(t.constructor.name, "StreamableHTTPClientTransport");
  });

  it("sse config produces an SSE transport", async () => {
    const t = await buildTransport(sse());
    assert.equal(t.constructor.name, "SSEClientTransport");
  });

  it("rejects unknown type at the type-guard level", async () => {
    await assert.rejects(
      () => buildTransport({ name: "bad", type: "ftp" as any, url: "x" } as any),
      /unknown transport type/i,
    );
  });
});
