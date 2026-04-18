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

import { buildClient, connectWithFallback } from "./transport.js";

describe("buildClient", () => {
  it("returns an SDK Client bound to the transport; throws wrapped error on init timeout", async () => {
    // stdio with a node process that never emits an init response → init timeout
    await assert.rejects(
      () =>
        buildClient({
          name: "bogus",
          type: "stdio",
          command: "node",
          args: ["-e", "setInterval(()=>{},1e6);"],
          timeout: 300,
        } as any),
      (err: Error) => err instanceof UnreachableError || err instanceof ProtocolError,
    );
  });
});

describe("connectWithFallback", () => {
  it("returns the first successful connect result without fallback", async () => {
    const calls: string[] = [];
    const fakeConnect = async (cfg: NormalizedConfig) => {
      calls.push(cfg.type);
      return { name: cfg.name } as any;
    };
    const result = await connectWithFallback(
      { name: "x", type: "http", url: "http://x", inferredFromUrl: true } as NormalizedConfig,
      fakeConnect,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0], "http");
    assert.equal(result.name, "x");
  });

  it("falls back to sse when http 4xxes AND type was inferred", async () => {
    const calls: string[] = [];
    const fakeConnect = async (cfg: NormalizedConfig) => {
      calls.push(cfg.type);
      if (cfg.type === "http") {
        const e: any = new Error("404 Not Found");
        e.code = 404;
        throw e;
      }
      return { name: cfg.name } as any;
    };
    const result = await connectWithFallback(
      { name: "x", type: "http", url: "http://x", inferredFromUrl: true } as NormalizedConfig,
      fakeConnect,
    );
    assert.deepEqual(calls, ["http", "sse"]);
    assert.equal(result.name, "x");
  });

  it("does NOT fall back when type was explicit", async () => {
    const calls: string[] = [];
    const fakeConnect = async (cfg: NormalizedConfig) => {
      calls.push(cfg.type);
      const e: any = new Error("404 Not Found");
      e.code = 404;
      throw e;
    };
    await assert.rejects(
      () =>
        connectWithFallback(
          { name: "x", type: "http", url: "http://x" } as NormalizedConfig, // no inferredFromUrl
          fakeConnect,
        ),
      /404/,
    );
    assert.deepEqual(calls, ["http"]);
  });

  it("maps 401 + WWW-Authenticate to RemoteAuthRequiredError", async () => {
    const fakeConnect = async (_cfg: NormalizedConfig) => {
      const e: any = new Error("401 Unauthorized");
      e.code = 401;
      e.headers = { "www-authenticate": 'Bearer realm="linear"' };
      throw e;
    };
    await assert.rejects(
      () =>
        connectWithFallback(
          { name: "linear", type: "http", url: "http://x", inferredFromUrl: true } as NormalizedConfig,
          fakeConnect,
        ),
      (err: Error) => err instanceof RemoteAuthRequiredError && err.serverName === "linear",
    );
  });

  it("bare 401 (no WWW-Authenticate) falls back to SSE when type was inferred", async () => {
    // 401 without a WWW-Authenticate header is not an auth challenge per the MCP
    // spec; treat it as a generic 4xx and try legacy SSE.
    const calls: string[] = [];
    const fakeConnect = async (cfg: NormalizedConfig) => {
      calls.push(cfg.type);
      if (cfg.type === "http") {
        const e: any = new Error("401 Unauthorized");
        e.code = 401;
        // no e.headers
        throw e;
      }
      return { name: cfg.name } as any;
    };
    const result = await connectWithFallback(
      { name: "x", type: "http", url: "http://x", inferredFromUrl: true } as NormalizedConfig,
      fakeConnect,
    );
    assert.deepEqual(calls, ["http", "sse"]);
    assert.equal(result.name, "x");
  });

  it("does NOT fall back on 5xx (server is reachable; fallback would mask bugs)", async () => {
    const calls: string[] = [];
    const fakeConnect = async (cfg: NormalizedConfig) => {
      calls.push(cfg.type);
      const e: any = new Error("500 Internal Server Error");
      e.code = 500;
      throw e;
    };
    await assert.rejects(
      () =>
        connectWithFallback(
          { name: "x", type: "http", url: "http://x", inferredFromUrl: true } as NormalizedConfig,
          fakeConnect,
        ),
      /500/,
    );
    assert.deepEqual(calls, ["http"]);
  });
});

import { buildAuthProvider } from "./oauth.js";

describe("buildTransport with auth provider", () => {
  function cfgHttp(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
    return { name: "srv", type: "http", url: "https://x/mcp", ...overrides } as NormalizedConfig;
  }

  it("passes authProvider through to StreamableHTTPClientTransport", async () => {
    const cfg = cfgHttp();
    const authProvider = buildAuthProvider(cfg, "/tmp/oh-test", async () => {});
    assert.ok(authProvider);
    const t = (await buildTransport(cfg, { authProvider })) as any;
    assert.ok(t._authProvider === authProvider);
    // Clean up callback listener that ready() would have bound (if accessed)
    authProvider.close();
  });

  it("no authProvider option → transport has no _authProvider", async () => {
    const t = (await buildTransport(cfgHttp())) as any;
    assert.equal(t._authProvider, undefined);
  });
});
