import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { JsonRpcRequest, JsonRpcResponse, McpToolDef } from './types.js';
import type { McpServerConfig } from '../harness/config.js';

export class McpClient {
  readonly name: string;
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private ready = false;

  private constructor(name: string, proc: ChildProcess) {
    this.name = name;
    this.proc = proc;

    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line) => {
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

    proc.on('exit', () => {
      for (const p of this.pending.values()) {
        p.reject(new Error(`MCP server '${name}' exited`));
      }
      this.pending.clear();
    });
  }

  static async connect(cfg: McpServerConfig, timeoutMs = 5_000): Promise<McpClient> {
    const proc = spawn(cfg.command, cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(cfg.env ?? {}) },
    });

    const client = new McpClient(cfg.name, proc);

    // Initialize handshake
    await Promise.race([
      client.call('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'openharness', version: '0.2.1' },
        capabilities: {},
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP '${cfg.name}' init timeout`)), timeoutMs)
      ),
    ]);

    await client.call('notifications/initialized', {});
    client.ready = true;
    return client;
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.call('tools/list', {});
    return ((res.result as any)?.tools ?? []) as McpToolDef[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.call('tools/call', { name, arguments: args });
    if (res.error) throw new Error(res.error.message);
    const content = (res.result as any)?.content ?? [];
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n');
  }

  private call(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(JSON.stringify(req) + '\n');
    });
  }

  disconnect(): void {
    this.proc.kill();
  }
}
