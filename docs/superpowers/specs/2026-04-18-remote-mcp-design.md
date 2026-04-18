# Remote MCP over HTTP and SSE — Design Spec

**Date:** 2026-04-18
**Status:** Draft
**Tier:** B (Claude Code parity)
**Target release:** `@zhijiewang/openharness@2.11.0`

## Context

OpenHarness's MCP client is stdio-only (`src/mcp/client.ts`, 166 lines). Hosted MCP servers — Sentry, Linear, GitHub managed, Anthropic-hosted, Make — speak Streamable HTTP (MCP spec 2025-03-26) or the legacy HTTP+SSE transport (2024-11-05). Today OH cannot consume any of them.

This is the largest remaining capability gap from the 2026-04-18 Tier-B backlog. Closing it unblocks a significant slice of the hosted-MCP ecosystem.

## Goals

1. Add `type: "http"` and `type: "sse"` MCP server entries to `.oh/config.yaml`.
2. Preserve all existing stdio behavior (config back-compat, retry/reconnect, disconnect lifecycle).
3. Replace our hand-rolled JSON-RPC stdio client with the official `@modelcontextprotocol/sdk` — inheriting session management, SSE parsing, `Last-Event-ID` resume, and future spec updates.
4. Support header-based auth (bearer tokens, API keys) with `${ENV}` interpolation.
5. Keep the public shape of `McpClient` so `loader.ts` / `McpTool.ts` / `DeferredMcpTool.ts` are untouched.

## Non-goals

- **OAuth 2.1 flow** — deferred. A 401 with `WWW-Authenticate` surfaces as a typed error that guides the user to configure headers. OAuth lands in a follow-up PR via the SDK's `AuthProvider` interface.
- **Keychain-backed token storage** — follows OAuth.
- **New transports beyond HTTP / SSE** — only the two shipped in the MCP spec.

## Approach

Adopt the official `@modelcontextprotocol/sdk`. Our hand-rolled stdio code (framing, JSON-RPC pending map, `readline` loop) is deleted in favor of the SDK's pluggable transports. OH code keeps ownership of config parsing, transport selection, retry/reconnect policy, env interpolation, and tool-def adaptation.

Rejected alternatives:

| Option | Effort | Why rejected |
|---|---|---|
| Extend hand-rolled client with `Transport` interface | ~5 days | Reimplementing session IDs, Accept negotiation, SSE parsing, `Last-Event-ID` resume, and SSE fallback carries real protocol-drift risk; maintenance burden grows with every spec revision |
| Hybrid — SDK for remote, hand-rolled stdio | ~4 days | Two code paths, largest surface, no offsetting benefit |

Chosen: **SDK-based, ~3 days.**

## Design

### 1. Dependency & module boundary

- Add `@modelcontextprotocol/sdk` (latest `1.x`) as a runtime dependency.
- Protocol framing, session IDs, SSE parsing, resume → owned by the SDK.
- OH owns: config parsing, transport construction, retry/reconnect policy, `${ENV}` interpolation, tool-def → `McpTool`/`DeferredMcpTool` adaptation, connected-clients registry.
- `src/mcp/client.ts` shrinks from 166 lines to ~80. `src/mcp/types.ts` loses `JsonRpcRequest` / `JsonRpcResponse` (SDK-provided).
- Public `McpClient` surface unchanged — callers in `loader.ts`, `McpTool.ts`, `DeferredMcpTool.ts` need no edits.

### 2. Config schema (discriminated union)

Replace the current `McpServerConfig` in `src/harness/config.ts:11` with a tagged union:

```ts
export type McpServerConfig = McpStdioConfig | McpHttpConfig | McpSseConfig;

type McpCommon = {
  name: string;
  riskLevel?: "low" | "medium" | "high";
  timeout?: number; // ms, default 5000
};

export type McpStdioConfig = McpCommon & {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpHttpConfig = McpCommon & {
  type: "http";
  url: string;
  headers?: Record<string, string>; // values support ${ENV} interpolation
};

export type McpSseConfig = McpCommon & {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};
```

**Normalization (`normalizeMcpConfig()` at load time):**

- Infer missing `type`: `command` present → `stdio`; `url` present → `http` (with SSE fallback at connect time).
- Interpolate `${VAR}` in every header value from `process.env`. Missing env var → drop the server with a non-fatal warning (mirrors the existing connect-failure fallback at `loader.ts:31-33`).
- `${VAR}` interpolation applies to `headers` only. `stdio.env` values pass through unchanged — no behavior change for existing configs.
- Validate: reject entries that set both `command` and `url`; `http`/`sse` without `url`; `stdio` without `command`.

**Back-compat:** existing stdio configs (`command: ...`) load unchanged — `type` defaults to `stdio`.

### 3. Transport construction & auto-fallback

New file `src/mcp/transport.ts`. Single entry point:

```ts
export async function buildTransport(cfg: McpServerConfig):
  Promise<{ sdkClient: Client; }>
```

**Dispatch by `type`:**

- `stdio` → `StdioClientTransport({ command, args, env })`
- `http` → `StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })`
- `sse` → `SSEClientTransport(new URL(url), { requestInit: { headers } })`

**Auto-fallback** — only when `type` was *inferred from url* (not when user wrote `type: "http"` or `type: "sse"` explicitly):

1. Attempt `StreamableHTTPClientTransport`.
2. On connect → return.
3. On 4xx during `initialize` (404/405/400, or 401 *without* a `WWW-Authenticate` header — which we interpret as "not an MCP auth challenge"; 401 *with* `WWW-Authenticate` raises `RemoteAuthRequiredError` instead):
   - Retry with `SSEClientTransport`.
   - On connect → return; log a one-line `[mcp] <name>: using legacy SSE transport` warning.
   - On failure → throw the original Streamable-HTTP error (primary signal).

If the user set `type: "http"` explicitly and init 4xxes, surface the error as-is — no silent downgrade.

**401 + `WWW-Authenticate`:** throw a typed `RemoteAuthRequiredError` carrying the realm. v1 does not attempt OAuth; the error message tells the user to add `headers.Authorization`. The SDK's `AuthProvider` slot is the seam a later OAuth PR plugs into.

**Timeouts:** `cfg.timeout` (default 5000ms) bounds the `initialize` handshake and each SDK request. Tool-call retry policy from today's `client.ts:105-143` ports unchanged.

### 4. `McpClient` wrapper

Thin adapter over the SDK's `Client`:

```ts
export class McpClient {
  readonly name: string;
  instructions: string | null = null;

  private sdk: SdkClient;
  private cfg: McpServerConfig;
  private timeoutMs: number;
  private dead = false;

  static async connect(cfg: McpServerConfig, timeoutMs?: number): Promise<McpClient>;
  async listTools(): Promise<McpToolDef[]>;
  async listResources(): Promise<Array<{ uri: string; name: string; description?: string }>>;
  async readResource(uri: string): Promise<string>;
  async callTool(name: string, args: Record<string, unknown>): Promise<string>;
  disconnect(): void;
}
```

**Retry/reconnect policy (semantics match `client.ts:105-143`):**

- `callTool` catches transport-closed / timeout errors → rebuilds the transport via `buildTransport(cfg)` → retries up to 2× total.
- Application-level tool errors (`isError: true` on SDK response) return as text without retrying.

**Instructions:** read from SDK's server-capabilities getter post-connect; stored on `client.instructions` as today.

**Lifecycle in `loader.ts`:** no signature changes. `McpClient.connect(server)` called the same way. `disconnectMcpClients()` calls `client.disconnect()` → SDK's `close()` handles stdin-close for stdio and `DELETE /mcp` for HTTP (explicit session termination per spec).

**New process-exit handler:** `loader.ts` registers `process.on("exit" | "SIGINT" | "SIGTERM")` once to call `disconnectMcpClients()`. Prevents leaking server-side session state when OH is killed outside the REPL's normal shutdown path.

### 5. Error taxonomy

| Error | When | User-facing message |
|---|---|---|
| `RemoteAuthRequiredError` | 401 + `WWW-Authenticate` on init | `"MCP server '<name>' requires authentication. Add headers.Authorization to your config (OAuth flow is not yet supported)."` |
| `UnreachableError` | DNS/TCP/TLS/timeout on init | `"MCP server '<name>' unreachable: <cause>"` |
| `ProtocolError` | Malformed response, SDK rejection | `"MCP server '<name>' protocol error: <cause>"` |
| Application tool error | `callTool` returned `isError: true` | Pass through SDK text content (today's behavior) |

All init failures are caught in `loader.ts` and logged as `[mcp] Failed to connect: <error>`; OH continues without that server (same policy as today's `loader.ts:31-33`).

## Testing

### Unit tests (hermetic, no network, no subprocesses)

- **`config.test.ts`** — normalization: infer `type`, `${ENV}` interpolation (present + missing), reject invalid combos (`command` + `url`, `http` without `url`), existing stdio configs load unchanged.
- **`transport.test.ts`** — dispatch picks correct SDK transport per `type`; fallback triggers on 4xx when `type` was inferred; fallback does NOT trigger when `type` was explicit; 401 + `WWW-Authenticate` maps to `RemoteAuthRequiredError`.
- **`client.test.ts`** — retry/reconnect path rebuilds transport and re-issues `callTool`; application errors (`isError`) are not retried; `disconnect()` calls SDK `close()`.

Mock SDK transports with `InMemoryTransport` or small in-memory `Transport`-shaped fakes — no real sockets, no spawned processes.

### Integration tests (opt-in, gated on `OH_INTEGRATION=1`)

- **`tests/integration/mcp-remote.test.ts`** — start the SDK's example HTTP server in-process on a random port; connect via `type: http`; call `listTools` and `callTool`; verify session-ID header is sent on follow-up requests.

Gating matches existing `ollama.test.ts` / `anthropic.test.ts` conventions.

### Existing tests

- `loader.test.ts`, `McpTool.test.ts`, `server.test.ts` — expected to pass unchanged (wrapper surface preserved).
- `schema.test.ts` — update if/where it asserts on `McpServerConfig` shape directly.

## Documentation

- **`docs/mcp-servers.md`** — create (or extend). One config example per `type`; `${ENV}` interpolation note; explicit OAuth-not-yet callout that quotes the `RemoteAuthRequiredError` text.
- **`README.md`** — add one HTTP config snippet to the MCP section.
- **`CHANGELOG.md`** — one line under unreleased: "Remote MCP over HTTP and SSE transports."

## Migration

Zero. Existing `.oh/config.yaml` stdio entries work without edits. Feature is purely additive.

## Release

Target `@zhijiewang/openharness@2.11.0`. Minor bump (new feature, no breaking changes). Standard release process (npm publish with provenance + GitHub Release), mirroring v2.10.0.

## Open questions

1. **OAuth follow-up scope** — ship as `2.12.0` with full OAuth 2.1 DCR + keychain storage? Or header-style `Authorization: Bearer ${OAUTH_TOKEN}` for users who run `mcp-remote` locally? Decide when ready to start.
2. **Server-initiated notifications** — the SDK supports the optional GET-for-server-requests channel. v1 simply doesn't open it (no UI surface for server→client notifications today). If/when we add `listChanged` subscriptions or sampling, the SDK already supports it.

## Out of scope (tracked for later)

- OAuth 2.1 device code / PKCE flow
- System-keychain credential storage
- `sampling/` server-initiated requests
- Connection pooling beyond the SDK defaults
- Prometheus-style metrics for MCP latency (separate telemetry effort)
