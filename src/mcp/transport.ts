import { createRequire } from "node:module";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { NormalizedConfig } from "./config-normalize.js";

const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };

export class RemoteAuthRequiredError extends Error {
  readonly serverName: string;
  readonly wwwAuthenticate: string | undefined;
  constructor(serverName: string, wwwAuthenticate: string | undefined) {
    super(
      `MCP server '${serverName}' requires authentication. ` +
        `Add 'auth: oauth' to enable the OAuth 2.1 flow, or set headers.Authorization for a static bearer token.`,
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

export type BuildTransportOptions = {
  authProvider?: OAuthClientProvider;
};

/**
 * Construct an SDK Transport for a normalized config.
 * Does NOT call .start() — caller (Client.connect) handles that.
 */
export async function buildTransport(cfg: NormalizedConfig, opts: BuildTransportOptions = {}): Promise<Transport> {
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
      authProvider: opts.authProvider,
    });
  }
  if (cfg.type === "sse") {
    return new SSEClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
      authProvider: opts.authProvider,
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
    console.warn(`[mcp] ${cfg.name}: Streamable HTTP failed (${(err as Error).message}); trying legacy SSE`);
    const sseCfg: NormalizedConfig = { ...cfg, type: "sse" } as NormalizedConfig;
    return await doConnect(sseCfg);
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const CLIENT_INFO = { name: "openharness", version: pkg.version } as const;

export type BuildClientOptions = {
  authProvider?: OAuthClientProvider;
};

/** Duck-type check: does this provider expose awaitCallback (our OhOAuthProvider)? */
function hasAwaitCallback(
  p: OAuthClientProvider,
): p is OAuthClientProvider & { awaitCallback(): Promise<{ code: string; state: string }> } {
  return typeof (p as any).awaitCallback === "function";
}

/**
 * Build a connected SDK Client for a normalized config.
 * Maps connect-time errors into OH's typed error taxonomy.
 *
 * When the auth provider exposes `awaitCallback()` (i.e. OhOAuthProvider), this
 * function handles the full OAuth callback → finishAuth → reconnect loop so callers
 * don't need to orchestrate it manually.
 */
export async function buildClient(cfg: NormalizedConfig, opts: BuildClientOptions = {}): Promise<Client> {
  const transport = await buildTransport(cfg, opts);
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const timeoutMs = cfg.timeout ?? DEFAULT_TIMEOUT_MS;

  async function tryConnect(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`init timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  try {
    await tryConnect();
    return client;
  } catch (err) {
    // If the SDK requires a browser-based OAuth flow (UnauthorizedError after REDIRECT),
    // and our provider knows how to await the callback, complete the loop here.
    // Per the SDK design, after finishAuth we must create a fresh transport + client
    // because the original transport is already in a "started" state.
    if (err instanceof UnauthorizedError && opts.authProvider && hasAwaitCallback(opts.authProvider)) {
      try {
        const { code } = await opts.authProvider.awaitCallback();
        await (transport as StreamableHTTPClientTransport).finishAuth(code);
        // Close the old transport before constructing a fresh one — the SDK's
        // Transport is one-shot after an UnauthorizedError; leaving it open leaks
        // the underlying TCP socket / event stream.
        try {
          await transport.close?.();
        } catch {
          // best-effort
        }
        // Build a fresh transport + client for the authenticated retry
        const freshTransport = await buildTransport(cfg, opts);
        const freshClient = new Client(CLIENT_INFO, { capabilities: {} });
        let freshTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            freshClient.connect(freshTransport),
            new Promise<never>((_, reject) => {
              freshTimer = setTimeout(() => reject(new Error(`init timeout after ${timeoutMs}ms`)), timeoutMs);
            }),
          ]);
        } finally {
          if (freshTimer !== null) clearTimeout(freshTimer);
        }
        return freshClient;
      } catch (oauthErr) {
        // Classify the retry error the same way as the primary path
        if (
          oauthErr instanceof RemoteAuthRequiredError ||
          oauthErr instanceof UnreachableError ||
          oauthErr instanceof ProtocolError
        ) {
          throw oauthErr;
        }
        throw new ProtocolError(cfg.name, oauthErr);
      }
    }

    // Leave RemoteAuthRequiredError / UnreachableError / ProtocolError as-is
    if (err instanceof RemoteAuthRequiredError || err instanceof UnreachableError || err instanceof ProtocolError) {
      throw err;
    }
    // Network-shaped errors (DNS, TCP, TLS, timeout) → Unreachable
    const msg = (err as Error)?.message ?? String(err);
    if (/timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(msg)) {
      throw new UnreachableError(cfg.name, err);
    }
    // Otherwise protocol-shaped
    throw new ProtocolError(cfg.name, err);
  }
}
