import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpServerConfig } from "../harness/config.js";
import { safeEnv } from "../utils/safe-env.js";
import type { JsonRpcRequest, JsonRpcResponse, McpToolDef } from "./types.js";

export class McpClient {
  readonly name: string;
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: set via Object.assign in static factory
  private ready = false;
  private dead = false;
  private cfg: McpServerConfig;
  private timeoutMs: number;

  private constructor(name: string, proc: ChildProcess, cfg: McpServerConfig, timeoutMs: number) {
    this.name = name;
    this.proc = proc;
    this.cfg = cfg;
    this.timeoutMs = timeoutMs;

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
      } catch {
        // non-JSON line from server (e.g. startup noise) — ignore
      }
    });

    proc.on("exit", () => {
      this.dead = true;
      for (const p of this.pending.values()) {
        p.reject(new Error(`MCP server '${name}' exited`));
      }
      this.pending.clear();
    });
  }

  /** Server-provided instructions (from capabilities during init) */
  instructions: string | null = null;

  static async connect(cfg: McpServerConfig, timeoutMs = cfg.timeout ?? 5_000): Promise<McpClient> {
    const proc = spawn(cfg.command, cfg.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: safeEnv(cfg.env),
    });

    const client = new McpClient(cfg.name, proc, cfg, timeoutMs);

    // Initialize handshake
    const initResponse = await Promise.race([
      client.call("initialize", {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "openharness", version: "0.2.1" },
        capabilities: {},
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP '${cfg.name}' init timeout`)), timeoutMs),
      ),
    ]);

    // Extract server instructions from init response
    const serverInfo = (initResponse as any)?.result;
    if (serverInfo?.instructions && typeof serverInfo.instructions === "string") {
      client.instructions = serverInfo.instructions;
    }

    await client.call("notifications/initialized", {});
    client.ready = true;
    return client;
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.call("tools/list", {});
    return ((res.result as any)?.tools ?? []) as McpToolDef[];
  }

  async listResources(): Promise<Array<{ uri: string; name: string; description?: string }>> {
    try {
      const res = await this.callWithTimeout("resources/list", {});
      return ((res.result as any)?.resources ?? []) as Array<{ uri: string; name: string; description?: string }>;
    } catch {
      return []; // Server may not support resources
    }
  }

  async readResource(uri: string): Promise<string> {
    const res = await this.callWithTimeout("resources/read", { uri });
    if (res.error) throw new Error(res.error.message);
    const contents = (res.result as any)?.contents ?? [];
    return contents
      .filter((c: any) => c.text)
      .map((c: any) => c.text as string)
      .join("\n");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.dead) {
      try {
        const fresh = await McpClient.connect(this.cfg, this.timeoutMs);
        Object.assign(this, { proc: fresh.proc, dead: false, ready: true, nextId: 1, pending: new Map() });
      } catch {
        throw new Error(`MCP server '${this.name}' died and restart failed`);
      }
    }

    // Retry up to 2 times for transient failures
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.callWithTimeout("tools/call", { name, arguments: args });
        if (res.error) throw new Error(res.error.message);
        const content = (res.result as any)?.content ?? [];
        return content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text as string)
          .join("\n");
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on timeout or server death — not on application errors
        if (!lastError.message.includes("timeout") && !lastError.message.includes("exited")) {
          throw lastError;
        }
        if (this.dead && attempt < 2) {
          try {
            const fresh = await McpClient.connect(this.cfg, this.timeoutMs);
            Object.assign(this, { proc: fresh.proc, dead: false, ready: true, nextId: 1, pending: new Map() });
          } catch {
            throw new Error(`MCP server '${this.name}' died and restart failed`);
          }
        }
      }
    }
    throw lastError ?? new Error(`MCP '${this.name}' call failed after retries`);
  }

  private callWithTimeout(method: string, params: unknown): Promise<JsonRpcResponse> {
    return Promise.race([
      this.call(method, params),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP '${this.name}' call timeout (${this.timeoutMs}ms)`)), this.timeoutMs),
      ),
    ]);
  }

  private call(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(`${JSON.stringify(req)}\n`);
    });
  }

  disconnect(): void {
    this.proc.kill();
  }
}
