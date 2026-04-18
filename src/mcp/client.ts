import { homedir } from "node:os";
import { join } from "node:path";
import type { Client as SdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import open from "open";
import type { McpServerConfig } from "../harness/config.js";
import { normalizeMcpConfig } from "./config-normalize.js";
import { buildAuthProvider } from "./oauth.js";
import { buildClient, connectWithFallback } from "./transport.js";
import type { McpToolDef } from "./types.js";

function credentialsDir(): string {
  return join(homedir(), ".oh", "credentials", "mcp");
}

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

  private constructor(
    name: string,
    cfg: McpServerConfig,
    sdk: SdkClient,
    timeoutMs: number,
    reconnect?: () => Promise<SdkClient>,
  ) {
    this.name = name;
    this.cfg = cfg;
    this.sdk = sdk;
    this.timeoutMs = timeoutMs;
    this.reconnectImpl = reconnect ?? (() => this.defaultReconnect());
    const instr = (sdk as any).getInstructions?.() as string | undefined;
    if (instr && typeof instr === "string") {
      this.instructions = instr;
    }
  }

  static async connect(
    cfg: McpServerConfig,
    timeoutMsOrOpts:
      | number
      | { timeoutMs?: number; openFn?: (url: string) => Promise<void>; storageDir?: string }
      | undefined = undefined,
  ): Promise<McpClient> {
    // Backward-compatible: accept number for timeout OR options object
    const opts = typeof timeoutMsOrOpts === "number" ? { timeoutMs: timeoutMsOrOpts } : (timeoutMsOrOpts ?? {});
    const timeoutMs = opts.timeoutMs ?? cfg.timeout ?? DEFAULT_TIMEOUT_MS;
    const openFn =
      opts.openFn ??
      (async (url: string) => {
        await open(url);
      });
    const storageDirResolved = opts.storageDir ?? credentialsDir();
    const normalized = normalizeMcpConfig(cfg, process.env);
    if (normalized.kind === "error") {
      throw new Error(normalized.message);
    }
    const authProvider = buildAuthProvider(normalized.cfg, storageDirResolved, openFn);
    if (authProvider) await authProvider.ready();
    try {
      const sdk = await connectWithFallback(normalized.cfg, (c) => buildClient(c, { authProvider }));
      return new McpClient(cfg.name, cfg, sdk, timeoutMs);
    } finally {
      authProvider?.close();
    }
  }

  /** Test-only constructor. Not exported from the package's public API. */
  static _forTesting(opts: ForTestingOptions): McpClient {
    return new McpClient(opts.name, opts.cfg, opts.sdk, opts.timeoutMs, opts.reconnect);
  }

  private async defaultReconnect(): Promise<SdkClient> {
    const normalized = normalizeMcpConfig(this.cfg, process.env);
    if (normalized.kind === "error") throw new Error(normalized.message);
    const authProvider = buildAuthProvider(normalized.cfg, credentialsDir(), async (url) => {
      await open(url);
    });
    if (authProvider) await authProvider.ready();
    try {
      return await connectWithFallback(normalized.cfg, (c) => buildClient(c, { authProvider }));
    } finally {
      authProvider?.close();
    }
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
          throw new Error(
            `MCP '${this.name}' died and reconnect failed: ${reErr instanceof Error ? reErr.message : String(reErr)}`,
          );
        }
      }
    }
    throw lastErr ?? new Error(`MCP '${this.name}' callTool failed after retries`);
  }

  disconnect(): void {
    void (this.sdk as any).close?.();
  }
}
