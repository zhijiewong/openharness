/**
 * DeferredTool — lazy-loads tool schemas to reduce system prompt size.
 *
 * Wraps a built-in tool with a minimal prompt (name + description only).
 * Full schema and prompt are loaded on first invocation or when resolved
 * via ToolSearch. This mirrors the DeferredMcpTool pattern.
 *
 * Token savings: deferred tools contribute ~15 tokens to the system prompt
 * instead of ~150, reducing context pressure by ~90% per deferred tool.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";
import type { RiskLevel } from "./types/permissions.js";

export class DeferredTool implements Tool<z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly riskLevel: RiskLevel;

  private inner: Tool;
  private _activated = false;

  constructor(tool: Tool) {
    this.inner = tool;
    this.name = tool.name;
    this.description = tool.description;
    this.riskLevel = tool.riskLevel;
    // Permissive schema until activated — accepts any object
    this.inputSchema = z.record(z.unknown());
  }

  /** Whether this tool has been activated (called or resolved) */
  get activated(): boolean {
    return this._activated;
  }

  isReadOnly(input: unknown): boolean {
    return this.inner.isReadOnly(input);
  }

  isConcurrencySafe(input: unknown): boolean {
    return this.inner.isConcurrencySafe(input);
  }

  async call(input: any, context: ToolContext): Promise<ToolResult> {
    this._activated = true;
    // Validate with the real schema
    const parsed = this.inner.inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        output: `Schema validation error: ${parsed.error.message}`,
        isError: true,
      };
    }
    return this.inner.call(parsed.data, context);
  }

  /** Minimal prompt when deferred, full prompt when activated */
  prompt(): string {
    if (this._activated) return this.inner.prompt();
    return `[deferred] ${this.name}: ${this.description}`;
  }

  /** Get the full inner tool (for ToolSearch resolution) */
  getInner(): Tool {
    return this.inner;
  }

  /** Activate this tool so it returns full prompt on next call to prompt() */
  activate(): void {
    this._activated = true;
  }
}
