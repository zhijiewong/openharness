# Remote MCP over HTTP/SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `type: "http"` and `type: "sse"` MCP server entries to `.oh/config.yaml` by adopting the official `@modelcontextprotocol/sdk`, replacing the hand-rolled stdio client while preserving its public surface.

**Architecture:** Keep `McpClient` as a thin repo-local wrapper over the SDK's `Client`. A new `src/mcp/transport.ts` dispatches to the right SDK transport (`StdioClientTransport` / `StreamableHTTPClientTransport` / `SSEClientTransport`) and implements auto-fallback from Streamable HTTP to legacy SSE when `type` is inferred. A new `src/mcp/config-normalize.ts` handles discriminated-union validation and `${ENV}` header interpolation. Callers (`loader.ts`, `McpTool.ts`, `DeferredMcpTool.ts`) are untouched.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk@^1`, Node.js `node:test`, `assert/strict`, Biome.

**Source spec:** `docs/superpowers/specs/2026-04-18-remote-mcp-design.md`

---

## File Structure

### Create
- `src/mcp/transport.ts` — `buildTransport()`, `RemoteAuthRequiredError`, `UnreachableError`, `ProtocolError`.
- `src/mcp/config-normalize.ts` — `normalizeMcpConfig()`, `interpolateHeaders()`.
- `src/mcp/transport.test.ts` — dispatch + fallback + error mapping.
- `src/mcp/config-normalize.test.ts` — union inference + interpolation + validation.
- `src/mcp/client.test.ts` — retry/reconnect semantics against a fake SDK client.
- `tests/integration/mcp-remote.test.ts` — opt-in HTTP server round-trip.
- `docs/mcp-servers.md` — user-facing config reference.

### Modify
- `package.json` — add `@modelcontextprotocol/sdk` dependency.
- `src/harness/config.ts` — replace `McpServerConfig` with discriminated union.
- `src/mcp/client.ts` — rewrite as SDK wrapper, preserve public surface.
- `src/mcp/types.ts` — remove `JsonRpcRequest` / `JsonRpcResponse`; keep `McpToolDef`.
- `src/mcp/loader.ts` — call `normalizeMcpConfig` before connect; add `process.on` exit handler.
- `README.md` — add HTTP server config snippet to MCP section.
- `CHANGELOG.md` — unreleased entry.

### Unchanged (but indirectly tested)
- `src/mcp/McpTool.ts`, `src/mcp/DeferredMcpTool.ts`, `src/mcp/McpTool.test.ts`, `src/mcp/loader.test.ts`, `src/mcp/server.ts`, `src/mcp/schema.ts`.

---

## Task 1: Add SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run:
```bash
npm install @modelcontextprotocol/sdk
```

Expected: `package.json` `dependencies` gains `"@modelcontextprotocol/sdk": "^1.x.y"` (whatever latest `1.x` is). `package-lock.json` updates.

- [ ] **Step 2: Verify type resolution**

Create a throwaway `src/mcp/_probe.ts`:
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export type _Probe = [typeof Client, typeof StdioClientTransport, typeof StreamableHTTPClientTransport, typeof SSEClientTransport];
```

Run:
```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Delete the probe and commit**

```bash
rm src/mcp/_probe.ts
git add package.json package-lock.json
git commit -m "deps: add @modelcontextprotocol/sdk for remote transports"
```

---

## Task 2: Discriminated-union config type

**Files:**
- Modify: `src/harness/config.ts:11-18`

- [ ] **Step 1: Write the failing test** (will land in Task 3's test file — skip writing a test here; this task is a type-only refactor whose consumers are tested downstream)

(No test for this task — it's a pure type change that either compiles or doesn't.)

- [ ] **Step 2: Replace the type**

In `src/harness/config.ts`, replace lines 11–18 (the current `McpServerConfig = { … }` object type):

```ts
export type McpCommonConfig = {
  name: string;
  riskLevel?: "low" | "medium" | "high";
  timeout?: number; // ms, default 5000
};

export type McpStdioConfig = McpCommonConfig & {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpHttpConfig = McpCommonConfig & {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpSseConfig = McpCommonConfig & {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioConfig | McpHttpConfig | McpSseConfig;
```

- [ ] **Step 3: Fix type errors in `client.ts` and `loader.ts` (temporary shim)**

`src/mcp/client.ts` currently reads `cfg.command`, `cfg.args`, `cfg.env` unconditionally. Narrow via a type guard for this interim commit — we rewrite the whole file in Task 6, but the build must stay green meanwhile.

At the top of `src/mcp/client.ts`, after the imports, add:
```ts
function assertStdio(cfg: McpServerConfig): asserts cfg is McpStdioConfig {
  if (cfg.type && cfg.type !== "stdio") {
    throw new Error(`MCP server '${cfg.name}' has type '${cfg.type}'; remote transports are not yet implemented`);
  }
  if (!("command" in cfg) || !cfg.command) {
    throw new Error(`MCP server '${cfg.name}' is missing 'command'`);
  }
}
```

Import `McpStdioConfig` alongside `McpServerConfig`:
```ts
import type { McpServerConfig, McpStdioConfig } from "../harness/config.js";
```

Then at the top of `McpClient.connect` (`src/mcp/client.ts:50`), add `assertStdio(cfg);` before `spawn()`.

- [ ] **Step 4: Run typecheck and tests**

```bash
npx tsc --noEmit
npm test
```
Expected: typecheck clean; all 985 existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/harness/config.ts src/mcp/client.ts
git commit -m "refactor(mcp): discriminated-union config for stdio/http/sse"
```

---

## Task 3: Config normalization + `${ENV}` interpolation

**Files:**
- Create: `src/mcp/config-normalize.ts`
- Create: `src/mcp/config-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/config-normalize.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { McpServerConfig } from "../harness/config.js";
import { normalizeMcpConfig } from "./config-normalize.js";

describe("normalizeMcpConfig", () => {
  it("infers type='stdio' when command is set and type is absent", () => {
    const out = normalizeMcpConfig({ name: "fs", command: "mcp-fs" } as McpServerConfig, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "stdio");
  });

  it("infers type='http' when url is set and type is absent", () => {
    const out = normalizeMcpConfig({ name: "api", url: "https://x/mcp" } as any, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "http");
    assert.equal((out.cfg as any).inferredFromUrl, true);
  });

  it("preserves explicit type='sse'", () => {
    const out = normalizeMcpConfig(
      { name: "legacy", type: "sse", url: "https://x/sse" } as McpServerConfig,
      {},
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "sse");
    assert.equal((out.cfg as any).inferredFromUrl, undefined);
  });

  it("rejects configs with both command and url", () => {
    const out = normalizeMcpConfig(
      { name: "mix", command: "x", url: "https://x" } as any,
      {},
    );
    assert.equal(out.kind, "error");
  });

  it("rejects type='http' without url", () => {
    const out = normalizeMcpConfig({ name: "x", type: "http" } as any, {});
    assert.equal(out.kind, "error");
  });

  it("rejects type='stdio' without command", () => {
    const out = normalizeMcpConfig({ name: "x", type: "stdio" } as any, {});
    assert.equal(out.kind, "error");
  });

  it("interpolates ${VAR} in header values from provided env", () => {
    const out = normalizeMcpConfig(
      {
        name: "linear",
        type: "http",
        url: "https://x",
        headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
      },
      { LINEAR_TOKEN: "abc123" },
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "http") return;
    assert.equal(out.cfg.headers?.Authorization, "Bearer abc123");
  });

  it("drops the server with an error when a referenced env var is missing", () => {
    const out = normalizeMcpConfig(
      {
        name: "linear",
        type: "http",
        url: "https://x",
        headers: { Authorization: "Bearer ${MISSING_TOKEN}" },
      },
      {},
    );
    assert.equal(out.kind, "error");
    if (out.kind !== "error") return;
    assert.match(out.message, /MISSING_TOKEN/);
  });

  it("passes stdio.env through without ${} interpolation (v1 scope)", () => {
    const out = normalizeMcpConfig(
      { name: "fs", command: "x", env: { FOO: "literal-${NOT_EXPANDED}" } },
      {},
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "stdio") return;
    assert.equal(out.cfg.env?.FOO, "literal-${NOT_EXPANDED}");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp/config-normalize.test.ts
```
Expected: FAIL — `normalizeMcpConfig` not defined.

- [ ] **Step 3: Implement `config-normalize.ts`**

Create `src/mcp/config-normalize.ts`:

```ts
import type { McpHttpConfig, McpServerConfig, McpSseConfig, McpStdioConfig } from "../harness/config.js";

/** Discriminated-union result: either a validated config or a human-readable error. */
export type NormalizeResult =
  | { kind: "ok"; cfg: NormalizedConfig }
  | { kind: "error"; message: string };

export type NormalizedConfig =
  | (McpStdioConfig & { type: "stdio" })
  | (McpHttpConfig & { inferredFromUrl?: boolean })
  | (McpSseConfig & { inferredFromUrl?: boolean });

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/** Replace ${VAR} references in `value` from `env`. Returns the new string or a missing-var name. */
function interpolate(value: string, env: Record<string, string | undefined>): { ok: true; value: string } | { ok: false; missing: string } {
  let missing: string | null = null;
  const out = value.replace(ENV_REF, (_match, varName) => {
    const v = env[varName];
    if (v === undefined) {
      if (missing === null) missing = varName;
      return "";
    }
    return v;
  });
  if (missing !== null) return { ok: false, missing };
  return { ok: true, value: out };
}

function interpolateHeaders(
  headers: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): { ok: true; headers: Record<string, string> | undefined } | { ok: false; missing: string } {
  if (!headers) return { ok: true, headers: undefined };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const r = interpolate(v, env);
    if (!r.ok) return { ok: false, missing: r.missing };
    out[k] = r.value;
  }
  return { ok: true, headers: out };
}

/**
 * Validate + normalize a raw MCP server config entry.
 * - Infers missing `type` from `command`/`url`.
 * - Interpolates ${ENV} in headers (http/sse only).
 * - Returns {kind:"error"} with a reason for any invalid combination.
 */
export function normalizeMcpConfig(
  raw: McpServerConfig,
  env: Record<string, string | undefined>,
): NormalizeResult {
  const hasCommand = "command" in raw && !!(raw as any).command;
  const hasUrl = "url" in raw && !!(raw as any).url;

  if (hasCommand && hasUrl) {
    return { kind: "error", message: `MCP '${raw.name}': config sets both 'command' and 'url'` };
  }

  const declaredType = raw.type;
  const effectiveType: "stdio" | "http" | "sse" | undefined =
    declaredType ?? (hasCommand ? "stdio" : hasUrl ? "http" : undefined);

  if (!effectiveType) {
    return { kind: "error", message: `MCP '${raw.name}': must set 'command' (stdio) or 'url' (http/sse)` };
  }

  if (effectiveType === "stdio") {
    if (!hasCommand) {
      return { kind: "error", message: `MCP '${raw.name}': type='stdio' requires 'command'` };
    }
    return { kind: "ok", cfg: { ...(raw as McpStdioConfig), type: "stdio" } };
  }

  // http or sse
  if (!hasUrl) {
    return { kind: "error", message: `MCP '${raw.name}': type='${effectiveType}' requires 'url'` };
  }
  const headers = (raw as McpHttpConfig | McpSseConfig).headers;
  const interp = interpolateHeaders(headers, env);
  if (!interp.ok) {
    return { kind: "error", message: `MCP '${raw.name}': env var '${interp.missing}' referenced in headers is not set` };
  }

  const inferred = declaredType === undefined;
  const base = { ...(raw as McpHttpConfig | McpSseConfig), type: effectiveType, headers: interp.headers };
  return {
    kind: "ok",
    cfg: inferred ? ({ ...base, inferredFromUrl: true } as NormalizedConfig) : (base as NormalizedConfig),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/mcp/config-normalize.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/config-normalize.ts src/mcp/config-normalize.test.ts
git commit -m "feat(mcp): config normalization + \${ENV} header interpolation"
```

---

## Task 4: Transport error types

**Files:**
- Create: `src/mcp/transport.ts` (partial — types only; builder added in Task 5)
- Create: `src/mcp/transport.test.ts` (partial — error-shape tests)

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/transport.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProtocolError, RemoteAuthRequiredError, UnreachableError } from "./transport.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: FAIL — module `./transport.js` not found.

- [ ] **Step 3: Create `src/mcp/transport.ts` with error types only**

```ts
export class RemoteAuthRequiredError extends Error {
  readonly serverName: string;
  readonly wwwAuthenticate: string | undefined;
  constructor(serverName: string, wwwAuthenticate: string | undefined) {
    super(
      `MCP server '${serverName}' requires authentication. ` +
        `Add headers.Authorization to your config (OAuth flow is not yet supported).`,
    );
    this.name = "RemoteAuthRequiredError";
    this.serverName = serverName;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

export class UnreachableError extends Error {
  readonly serverName: string;
  readonly cause: unknown;
  constructor(serverName: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`MCP server '${serverName}' unreachable: ${causeMsg}`);
    this.name = "UnreachableError";
    this.serverName = serverName;
    this.cause = cause;
  }
}

export class ProtocolError extends Error {
  readonly serverName: string;
  readonly cause: unknown;
  constructor(serverName: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`MCP server '${serverName}' protocol error: ${causeMsg}`);
    this.name = "ProtocolError";
    this.serverName = serverName;
    this.cause = cause;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/transport.ts src/mcp/transport.test.ts
git commit -m "feat(mcp): transport error types (RemoteAuthRequired, Unreachable, Protocol)"
```

---

## Task 5: `buildTransport()` — dispatch + auto-fallback

**Files:**
- Modify: `src/mcp/transport.ts` (add `buildTransport`)
- Modify: `src/mcp/transport.test.ts` (add dispatch + fallback tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/mcp/transport.test.ts`:

```ts
import type { NormalizedConfig } from "./config-normalize.js";
import { buildTransport } from "./transport.js";

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
```

(Fallback behavior is tested via `connectWithFallback` — added next step.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: FAIL — `buildTransport` not exported.

- [ ] **Step 3: Implement `buildTransport` in `src/mcp/transport.ts`**

Add to the bottom of `src/mcp/transport.ts`:

```ts
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { NormalizedConfig } from "./config-normalize.js";

/**
 * Construct an SDK Transport for a normalized config.
 * Does NOT call .start() — caller (Client.connect) handles that.
 */
export async function buildTransport(cfg: NormalizedConfig): Promise<Transport> {
  if (cfg.type === "stdio") {
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
    });
  }
  if (cfg.type === "http") {
    return new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
  }
  if (cfg.type === "sse") {
    return new SSEClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
  }
  throw new Error(`unknown transport type: ${(cfg as any).type}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/transport.ts src/mcp/transport.test.ts
git commit -m "feat(mcp): buildTransport dispatch for stdio/http/sse"
```

---

## Task 6: `connectWithFallback()` — auto-retry legacy SSE

**Files:**
- Modify: `src/mcp/transport.ts` (add `connectWithFallback`)
- Modify: `src/mcp/transport.test.ts` (add fallback tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/mcp/transport.test.ts`:

```ts
import { connectWithFallback, buildClient } from "./transport.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: FAIL — `connectWithFallback` not exported.

- [ ] **Step 3: Implement `connectWithFallback`**

Append to `src/mcp/transport.ts` (after `buildTransport`):

```ts
/**
 * Does this error indicate "try the legacy SSE transport instead"?
 * Yes for 4xx OTHER than 401-with-WWW-Authenticate (which is a real auth challenge).
 */
function isFallbackCandidate(err: unknown): boolean {
  const code = (err as any)?.code;
  if (typeof code !== "number") return false;
  if (code < 400 || code >= 500) return false;
  if (code === 401) {
    const www = (err as any)?.headers?.["www-authenticate"];
    if (typeof www === "string" && www.length > 0) return false;
  }
  return true;
}

function extractWwwAuthenticate(err: unknown): string | undefined {
  const code = (err as any)?.code;
  if (code !== 401) return undefined;
  const www = (err as any)?.headers?.["www-authenticate"];
  return typeof www === "string" ? www : undefined;
}

/**
 * Connect to an MCP server, with auto-fallback from Streamable HTTP to
 * legacy SSE when the config's type was INFERRED from url (not explicit).
 *
 * `doConnect` is the side-effecting step — built/connect a transport and
 * return the opaque client. Kept injectable for tests; production call-site
 * wires it to `buildClient` (Task 7).
 */
export async function connectWithFallback<T>(
  cfg: NormalizedConfig,
  doConnect: (cfg: NormalizedConfig) => Promise<T>,
): Promise<T> {
  try {
    return await doConnect(cfg);
  } catch (err) {
    // Auth challenge → surface immediately, never fall back
    const www = extractWwwAuthenticate(err);
    if (www !== undefined) throw new RemoteAuthRequiredError(cfg.name, www);

    // Explicit type → surface as-is
    const inferred = (cfg as any).inferredFromUrl === true;
    if (!inferred) throw err;

    // Only http-was-inferred-first falls back to sse; other shapes surface
    if (cfg.type !== "http") throw err;

    if (!isFallbackCandidate(err)) throw err;

    // Log + retry
    // biome-ignore lint/suspicious/noConsole: user-facing diagnostic
    console.warn(`[mcp] ${cfg.name}: Streamable HTTP failed (${(err as Error).message}); trying legacy SSE`);
    const sseCfg: NormalizedConfig = { ...cfg, type: "sse" } as NormalizedConfig;
    return await doConnect(sseCfg);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/transport.ts src/mcp/transport.test.ts
git commit -m "feat(mcp): auto-fallback from Streamable HTTP to legacy SSE"
```

---

## Task 7: `buildClient()` — compose SDK Client with transport

**Files:**
- Modify: `src/mcp/transport.ts` (add `buildClient`)

- [ ] **Step 1: Write the failing test**

Append to `src/mcp/transport.test.ts`:

```ts
describe("buildClient", () => {
  it("returns an SDK Client bound to the transport; throws wrapped error on init failure", async () => {
    // stdio with a command that never emits an init response → init timeout
    const client = await assert.rejects(
      () =>
        buildClient(
          { name: "bogus", type: "stdio", command: "node", args: ["-e", "setInterval(()=>{},1e6);"], timeout: 300 } as any,
        ),
      (err: Error) => err instanceof UnreachableError || err instanceof ProtocolError,
    );
    void client;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: FAIL — `buildClient` not exported.

- [ ] **Step 3: Implement `buildClient`**

Append to `src/mcp/transport.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const CLIENT_INFO = { name: "openharness", version: "0.2.1" } as const;

/**
 * Build a connected SDK Client for a normalized config.
 * Maps connect-time errors into OH's typed error taxonomy.
 */
export async function buildClient(cfg: NormalizedConfig): Promise<Client> {
  const transport = await buildTransport(cfg);
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const timeoutMs = cfg.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`init timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return client;
  } catch (err) {
    // Leave RemoteAuthRequiredError / UnreachableError / ProtocolError as-is
    if (
      err instanceof RemoteAuthRequiredError ||
      err instanceof UnreachableError ||
      err instanceof ProtocolError
    ) {
      throw err;
    }
    // Network-shaped errors (DNS, TCP, TLS, timeout) → Unreachable
    const msg = (err as Error)?.message ?? String(err);
    if (
      /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(msg)
    ) {
      throw new UnreachableError(cfg.name, err);
    }
    // Otherwise protocol-shaped
    throw new ProtocolError(cfg.name, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test src/mcp/transport.test.ts
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/transport.ts src/mcp/transport.test.ts
git commit -m "feat(mcp): buildClient with typed error mapping"
```

---

## Task 8: Rewrite `McpClient` as SDK wrapper

**Files:**
- Modify: `src/mcp/client.ts` (full rewrite)
- Modify: `src/mcp/types.ts` (remove JSON-RPC types)
- Create: `src/mcp/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/client.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { McpClient } from "./client.js";

/**
 * Minimal SDK-Client shape we rely on. Tests inject a fake instead of the
 * real SDK to keep unit tests hermetic.
 */
function fakeSdkClient(overrides: Partial<{
  listTools: () => Promise<{ tools: unknown[] }>;
  callTool: (req: { name: string; arguments: unknown }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  listResources: () => Promise<{ resources: unknown[] }>;
  readResource: (r: { uri: string }) => Promise<{ contents: Array<{ text?: string }> }>;
  getServerVersion: () => { instructions?: string } | undefined;
  close: () => Promise<void>;
}> = {}) {
  return {
    listTools: overrides.listTools ?? (async () => ({ tools: [] })),
    callTool:
      overrides.callTool ??
      (async () => ({ content: [{ type: "text", text: "ok" }] })),
    listResources: overrides.listResources ?? (async () => ({ resources: [] })),
    readResource: overrides.readResource ?? (async (_r) => ({ contents: [{ text: "res" }] })),
    getServerVersion: overrides.getServerVersion ?? (() => undefined),
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

  it("instructions field is populated from SDK getServerVersion()", async () => {
    const sdk = fakeSdkClient({
      getServerVersion: () => ({ instructions: "follow these rules" }),
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
    // close is async; wait a tick
    await new Promise((r) => setImmediate(r));
    assert.equal(closeSpy.mock.callCount(), 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/mcp/client.test.ts
```
Expected: FAIL — `McpClient._forTesting` doesn't exist and `callTool` doesn't throw on app errors.

- [ ] **Step 3: Rewrite `src/mcp/client.ts` as the SDK wrapper**

Replace the entire contents of `src/mcp/client.ts`:

```ts
import type { Client as SdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServerConfig } from "../harness/config.js";
import { normalizeMcpConfig } from "./config-normalize.js";
import { buildClient, connectWithFallback } from "./transport.js";
import type { McpToolDef } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5_000;

type ForTestingOptions = {
  name: string;
  cfg: McpServerConfig;
  sdk: SdkClient;
  timeoutMs: number;
  reconnect?: () => Promise<SdkClient>;
};

export class McpClient {
  readonly name: string;
  instructions: string | null = null;

  private sdk: SdkClient;
  private cfg: McpServerConfig;
  private timeoutMs: number;
  private reconnectImpl: () => Promise<SdkClient>;

  private constructor(name: string, cfg: McpServerConfig, sdk: SdkClient, timeoutMs: number, reconnect?: () => Promise<SdkClient>) {
    this.name = name;
    this.cfg = cfg;
    this.sdk = sdk;
    this.timeoutMs = timeoutMs;
    this.reconnectImpl = reconnect ?? (() => this.defaultReconnect());
    const version = (sdk as any).getServerVersion?.() as { instructions?: string } | undefined;
    if (version?.instructions && typeof version.instructions === "string") {
      this.instructions = version.instructions;
    }
  }

  static async connect(cfg: McpServerConfig, timeoutMs: number = cfg.timeout ?? DEFAULT_TIMEOUT_MS): Promise<McpClient> {
    const normalized = normalizeMcpConfig(cfg, process.env);
    if (normalized.kind === "error") {
      throw new Error(normalized.message);
    }
    const sdk = await connectWithFallback(normalized.cfg, (c) => buildClient(c));
    return new McpClient(cfg.name, cfg, sdk, timeoutMs);
  }

  /** Test-only constructor. Not exported from the package. */
  static _forTesting(opts: ForTestingOptions): McpClient {
    const client = new McpClient(opts.name, opts.cfg, opts.sdk, opts.timeoutMs, opts.reconnect);
    return client;
  }

  private async defaultReconnect(): Promise<SdkClient> {
    const normalized = normalizeMcpConfig(this.cfg, process.env);
    if (normalized.kind === "error") throw new Error(normalized.message);
    return connectWithFallback(normalized.cfg, (c) => buildClient(c));
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await (this.sdk as any).listTools();
    return (res?.tools ?? []) as McpToolDef[];
  }

  async listResources(): Promise<Array<{ uri: string; name: string; description?: string }>> {
    try {
      const res = await (this.sdk as any).listResources();
      return (res?.resources ?? []) as Array<{ uri: string; name: string; description?: string }>;
    } catch {
      return []; // Server may not support resources
    }
  }

  async readResource(uri: string): Promise<string> {
    const res = await (this.sdk as any).readResource({ uri });
    const contents = res?.contents ?? [];
    return contents
      .filter((c: any) => typeof c.text === "string")
      .map((c: any) => c.text as string)
      .join("\n");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Retry up to 2 times on transport-closed / timeout errors
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await (this.sdk as any).callTool({ name, arguments: args });
        const content = (res?.content ?? []) as Array<{ type: string; text?: string }>;
        const text = content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n");
        if (res?.isError) {
          throw new Error(text || `MCP tool '${name}' returned an error`);
        }
        return text;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message;
        const retryable = /transport closed|timeout|ECONNRESET|stream closed|socket hang up/i.test(msg);
        if (!retryable || attempt === 2) throw lastErr;
        try {
          this.sdk = await this.reconnectImpl();
        } catch (reErr) {
          throw new Error(`MCP '${this.name}' died and reconnect failed: ${reErr instanceof Error ? reErr.message : String(reErr)}`);
        }
      }
    }
    throw lastErr ?? new Error(`MCP '${this.name}' callTool failed after retries`);
  }

  disconnect(): void {
    void (this.sdk as any).close?.();
  }
}
```

- [ ] **Step 4: Delete JSON-RPC types from `src/mcp/types.ts`**

Replace `src/mcp/types.ts` entirely with:

```ts
/** MCP tool definition as returned by `tools/list`. */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx tsc --noEmit
npx tsx --test src/mcp/client.test.ts
npm test
```
Expected: typecheck clean; all `client.test.ts` tests pass; full suite green (`McpTool.test.ts`, `loader.test.ts`, `schema.test.ts`, `server.test.ts` still pass because the `McpClient` public surface is preserved).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/client.ts src/mcp/types.ts src/mcp/client.test.ts
git commit -m "refactor(mcp): rewrite McpClient as @modelcontextprotocol/sdk wrapper"
```

---

## Task 9: Loader wiring + process-exit handler

**Files:**
- Modify: `src/mcp/loader.ts`

- [ ] **Step 1: Add process-exit handler in `loader.ts`**

In `src/mcp/loader.ts`, after the `connectedClients: McpClient[]` declaration (line 7), add:

```ts
let exitHandlerInstalled = false;

function installExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  const handler = () => {
    try {
      disconnectMcpClients();
    } catch {
      /* shutdown best-effort */
    }
  };
  process.once("exit", handler);
  process.once("SIGINT", () => {
    handler();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    handler();
    process.exit(143);
  });
}
```

Inside `loadMcpTools()` (currently `src/mcp/loader.ts:13`), add at the top of the function (before the `if (servers.length === 0)` guard):

```ts
  installExitHandler();
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
npm test
```
Expected: all 985+ tests pass. `loader.test.ts` still passes unchanged.

- [ ] **Step 3: Manual sanity check (optional)**

With no MCP servers configured, `npm run dev` and Ctrl+C. Expected: clean exit, no hang.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/loader.ts
git commit -m "feat(mcp): install process-exit handler for clean remote session teardown"
```

---

## Task 10: Integration test (opt-in)

**Files:**
- Create: `tests/integration/mcp-remote.test.ts`
- Modify: `scripts/test.mjs` (ensure it ONLY picks up `src/**/*.test.ts` — currently `findTests("src")`, so it already skips `tests/` — verify and document)

- [ ] **Step 1: Create the integration test file**

Create `tests/integration/mcp-remote.test.ts`:

```ts
/**
 * Remote MCP end-to-end smoke test.
 * Opt-in: runs only when OH_INTEGRATION=1.
 *
 * Starts an in-process Streamable HTTP MCP server using the SDK, connects
 * via OH's McpClient with type: "http", calls listTools() and callTool().
 *
 * Run:
 *   OH_INTEGRATION=1 npx tsx --test tests/integration/mcp-remote.test.ts
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpClient } from "../../src/mcp/client.js";

const RUN = process.env.OH_INTEGRATION === "1";

describe("remote MCP (Streamable HTTP) — integration", { skip: !RUN }, () => {
  it("lists tools and calls a tool over HTTP", async () => {
    // --- spin up server ---
    const server = new McpServer({ name: "itest", version: "0.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "echo", description: "echoes input", inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => ({
      content: [{ type: "text", text: `echo:${(req.params.arguments as any).msg}` }],
    }));

    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const http = createServer(async (req, res) => {
      const sid = (req.headers["mcp-session-id"] as string) ?? "default";
      let t = sessions.get(sid);
      if (!t) {
        t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
        sessions.set(sid, t);
        await server.connect(t);
      }
      await t.handleRequest(req, res);
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const port = (http.address() as AddressInfo).port;

    try {
      // --- connect OH client ---
      const client = await McpClient.connect({
        name: "itest",
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
      });

      const tools = await client.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0]!.name, "echo");

      const result = await client.callTool("echo", { msg: "hello" });
      assert.equal(result, "echo:hello");

      client.disconnect();
    } finally {
      http.close();
    }
  });
});
```

- [ ] **Step 2: Confirm `scripts/test.mjs` scope**

Read `scripts/test.mjs` — it scans `findTests("src")`, so `tests/integration/*` is correctly excluded from the default `npm test`.

Add a comment at the top of `scripts/test.mjs`:
```js
// Integration tests live under tests/integration/ and are opt-in; run them with:
//   OH_INTEGRATION=1 npx tsx --test tests/integration/<name>.test.ts
```

- [ ] **Step 3: Run integration test locally to verify it works**

```bash
OH_INTEGRATION=1 npx tsx --test tests/integration/mcp-remote.test.ts
```
Expected: 1 pass. If the SDK server exports differ in the installed version, adjust imports to match (look at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/*.d.ts`).

- [ ] **Step 4: Run default suite to confirm integration test is skipped**

```bash
npm test
```
Expected: no integration-test failures; count matches Task 8 baseline.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/mcp-remote.test.ts scripts/test.mjs
git commit -m "test(mcp): opt-in Streamable HTTP integration smoke test"
```

---

## Task 11: User-facing docs

**Files:**
- Create: `docs/mcp-servers.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Create `docs/mcp-servers.md`**

```markdown
# MCP Servers

OpenHarness connects to Model Context Protocol (MCP) servers via three transports:

| Transport | Use for |
|---|---|
| `stdio` (default) | Local subprocess servers (most open-source MCP servers) |
| `http` | Remote Streamable HTTP servers (Linear, Sentry, GitHub managed, Anthropic-hosted) |
| `sse` | Legacy HTTP+SSE servers |

Configure servers in `.oh/config.yaml` under the top-level `mcpServers:` key.

## stdio (default)

```yaml
mcpServers:
  - name: filesystem
    command: mcp-server-fs
    args: [--root, /tmp]
    env: { LOG_LEVEL: debug }
```

`type` defaults to `stdio` when `command` is set.

## Streamable HTTP

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
```

Header values support `${VAR}` interpolation from `process.env`. If the referenced var is not set, OH skips the server with a warning and continues.

## Legacy SSE

```yaml
mcpServers:
  - name: self-hosted
    type: sse
    url: https://mcp.internal.example.com/sse
    headers:
      X-API-Key: "${INTERNAL_KEY}"
```

## Auto-fallback

When you provide `url:` without `type:`, OH tries Streamable HTTP first and falls back to legacy SSE on HTTP 4xx. Set `type:` explicitly to disable fallback.

## Authentication

Only header-based auth is supported in this release. If a server responds with `401` + `WWW-Authenticate`, OH raises:

> `MCP server '<name>' requires authentication. Add headers.Authorization to your config (OAuth flow is not yet supported).`

OAuth 2.1 (device code, DCR, keychain token storage) is planned for a follow-up release.
```

- [ ] **Step 2: Add HTTP snippet to `README.md`**

Find the existing MCP section in `README.md` (search for `mcpServers` or `MCP`). Append an HTTP example right after the stdio example, plus a one-liner pointing at the new docs page:

```markdown
### Remote MCP servers (HTTP / SSE)

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
```

See [docs/mcp-servers.md](docs/mcp-servers.md) for the full reference.
```

(If `README.md` has no MCP section, add one after the "Features" section.)

- [ ] **Step 3: Update `CHANGELOG.md`**

Find the "Unreleased" section (or top of file). Add:

```markdown
## Unreleased

### Added
- Remote MCP over HTTP and SSE transports. Configure with `type: http` or `type: sse` in `.oh/config.yaml`; supports header-based auth with `${ENV}` interpolation. See `docs/mcp-servers.md`. OAuth 2.1 deferred to a follow-up release.

### Changed
- Internal: `@modelcontextprotocol/sdk` now owns JSON-RPC framing and protocol lifecycle. `McpClient` public surface (`connect`, `listTools`, `callTool`, `listResources`, `readResource`, `disconnect`, `instructions`) unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add docs/mcp-servers.md README.md CHANGELOG.md
git commit -m "docs: remote MCP transport reference and changelog"
```

---

## Task 12: Release v2.11.0

**Files:**
- Modify: `package.json` (version bump)
- Modify: `CHANGELOG.md` (finalize release header)

- [ ] **Step 1: Final full-suite run**

```bash
npm run lint
npx tsc --noEmit
npm test
OH_INTEGRATION=1 npx tsx --test tests/integration/mcp-remote.test.ts
```
Expected: all four pass.

- [ ] **Step 2: Bump version**

Edit `package.json`:
```diff
-  "version": "2.10.0",
+  "version": "2.11.0",
```

- [ ] **Step 3: Finalize changelog**

In `CHANGELOG.md`, replace the `## Unreleased` header with `## 2.11.0 — 2026-04-XX` (use the commit date).

- [ ] **Step 4: Commit and tag**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v2.11.0 — remote MCP over HTTP/SSE"
git tag v2.11.0
```

- [ ] **Step 5: Push and publish**

```bash
git push origin main --tags
npm publish --access public --provenance
```

Then create the GitHub Release from the tag with the changelog body (follow the same process as v2.10.0).

---

## Self-Review

### Spec coverage

| Spec section | Implementing task(s) |
|---|---|
| § 1 Dependency & module boundary | 1, 8 |
| § 2 Config schema (discriminated union) | 2 |
| § 2 Normalization + env interpolation | 3 |
| § 3 Transport dispatch | 5 |
| § 3 Auto-fallback (inferred only) | 6 |
| § 3 401 + WWW-Authenticate → RemoteAuthRequiredError | 4, 6 |
| § 3 Timeouts | 7 |
| § 4 McpClient wrapper, retry/reconnect | 8 |
| § 4 Instructions field | 8 |
| § 4 Process-exit handler | 9 |
| § 5 Error taxonomy (RemoteAuthRequiredError, UnreachableError, ProtocolError) | 4, 7 |
| Testing § unit | 3, 4, 5, 6, 7, 8 |
| Testing § integration | 10 |
| Docs § mcp-servers.md / README / CHANGELOG | 11 |
| Release § v2.11.0 | 12 |

All spec requirements covered.

### Placeholder scan

No "TBD", "TODO", "implement later", "handle edge cases", or similar vague instructions. Each step contains the exact code or command. Task 2 Step 1 explicitly notes *why* there's no test in that task (pure type refactor), not left silent.

### Type consistency

- `NormalizedConfig` used identically in Tasks 3, 5, 6, 7, 8.
- `McpClient` public signatures match today's and match what Task 8 tests expect.
- `buildClient` signature and `connectWithFallback` signature align in Task 7 vs Task 6.
- Error class names (`RemoteAuthRequiredError`, `UnreachableError`, `ProtocolError`) consistent across Tasks 4, 6, 7.
- `fakeSdkClient` in Task 8 uses the SDK's actual response shapes (`{ tools }`, `{ content, isError }`, `{ contents }`).

All consistent.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-remote-mcp.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
