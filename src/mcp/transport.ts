import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { NormalizedConfig } from "./config-normalize.js";

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
 * `doConnect` is the side-effecting step — build/connect a transport and
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
