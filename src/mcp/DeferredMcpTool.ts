import { z } from 'zod';
import type { Tool, ToolResult, ToolContext } from '../Tool.js';
import type { McpClient } from './client.js';
import type { McpToolDef } from './types.js';
import { McpTool } from './McpTool.js';

/**
 * A deferred MCP tool that only stores its name at startup.
 * The full schema is fetched on first use, avoiding context bloat
 * when hundreds of MCP tools are available.
 */
export class DeferredMcpTool implements Tool<z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly riskLevel: "low" | "medium" | "high";

  private client: McpClient;
  private toolName: string; // original MCP tool name
  private resolved: McpTool | null = null;
  private resolvePromise: Promise<McpTool | null> | null = null;
  private _riskLevel: "low" | "medium" | "high";

  constructor(
    client: McpClient,
    toolName: string,
    description: string,
    riskLevel: "low" | "medium" | "high" = "medium",
  ) {
    this.client = client;
    this.toolName = toolName;
    this._riskLevel = riskLevel;
    this.riskLevel = riskLevel;
    this.name = `${client.name}__${toolName}`;
    this.description = description || toolName;
    // Permissive schema — accepts anything until resolved
    this.inputSchema = z.record(z.unknown());
  }

  isReadOnly(_input: unknown): boolean { return false; }
  isConcurrencySafe(_input: unknown): boolean { return false; }

  /** Resolve the full tool definition from the MCP server */
  private async resolve(): Promise<McpTool | null> {
    if (this.resolved) return this.resolved;
    if (this.resolvePromise) return this.resolvePromise;

    this.resolvePromise = (async () => {
      try {
        const defs = await this.client.listTools();
        const def = defs.find(d => d.name === this.toolName);
        if (def) {
          this.resolved = new McpTool(this.client, def, this._riskLevel);
          return this.resolved;
        }
        return null;
      } catch {
        return null;
      }
    })();

    return this.resolvePromise;
  }

  async call(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // Resolve on first call
    const resolved = await this.resolve();
    if (resolved) {
      return resolved.call(input, context);
    }
    // Fallback: call directly without schema validation
    try {
      const output = await this.client.callTool(this.toolName, input);
      return { output, isError: false };
    } catch (err) {
      return { output: String(err), isError: true };
    }
  }

  prompt(): string {
    return `[mcp:${this.client.name}] ${this.description} (deferred — schema loaded on use)`;
  }

  /** Get the full resolved tool definition (for ToolSearch) */
  async getResolved(): Promise<McpTool | null> {
    return this.resolve();
  }
}
