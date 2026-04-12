import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import type { McpClient } from "./client.js";
import type { McpToolDef } from "./types.js";

/** Wraps an MCP tool as an OpenHarness Tool */
export class McpTool implements Tool<z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly riskLevel: "low" | "medium" | "high";

  private client: McpClient;
  private def: McpToolDef;

  constructor(client: McpClient, def: McpToolDef, riskLevel: "low" | "medium" | "high" = "medium") {
    this.client = client;
    this.def = def;
    this.riskLevel = riskLevel;
    this.name = `${client.name}__${def.name}`;
    this.description = def.description ?? def.name;

    // Build a Zod schema from the MCP inputSchema
    const props = def.inputSchema.properties ?? {};
    const required = new Set(def.inputSchema.required ?? []);
    const shape: Record<string, z.ZodType> = {};
    for (const [key, val] of Object.entries(props)) {
      const base: z.ZodType = val.type === "number" ? z.number() : val.type === "boolean" ? z.boolean() : z.string();
      shape[key] = required.has(key) ? base : base.optional();
    }
    this.inputSchema = z.object(shape);
  }

  isReadOnly(_input: unknown): boolean {
    return false;
  }
  isConcurrencySafe(_input: unknown): boolean {
    return false;
  }

  async call(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    try {
      const output = await this.client.callTool(this.def.name, input);
      return { output, isError: false };
    } catch (err) {
      return { output: String(err), isError: true };
    }
  }

  prompt(): string {
    return `[mcp:${this.client.name}] ${this.description}`;
  }
}
