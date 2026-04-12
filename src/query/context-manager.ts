/**
 * Active Context Management — proactive control of the context window.
 *
 * Unlike reactive compression (trigger at 80% full), active management:
 * - Enforces per-tool token budgets (no single tool consumes the window)
 * - Folds sub-agent output to summaries (parent sees prompt + result only)
 * - Pre-compresses before large tool calls
 * - Auto-summarizes when approaching limits
 *
 * Based on the "context engineering" pattern from Anthropic's harness research.
 */

import { getContextWindow } from "../harness/cost.js";
import type { Message } from "../types/message.js";
import { estimateMessagesTokens } from "./compress.js";

// ── Types ──

export type ContextBudget = {
  /** Max tokens for a single tool output */
  toolOutputMax: number;
  /** Per-tool overrides */
  perTool: Record<string, number>;
  /** Whether to auto-fold sub-agent results */
  autoFold: boolean;
  /** Context usage threshold to trigger proactive compression (0-1) */
  proactiveThreshold: number;
};

const DEFAULT_BUDGET: ContextBudget = {
  toolOutputMax: 10_000,
  perTool: {},
  autoFold: true,
  proactiveThreshold: 0.6,
};

// ── Context Manager ──

export class ContextManager {
  private budget: ContextBudget;
  private model: string | undefined;

  constructor(budget?: Partial<ContextBudget>, model?: string) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.model = model;
  }

  /** Get the token budget for a specific tool */
  getToolBudget(toolName: string): number {
    return this.budget.perTool[toolName] ?? this.budget.toolOutputMax;
  }

  /** Set a per-tool token budget */
  setToolBudget(toolName: string, maxTokens: number): void {
    this.budget.perTool[toolName] = maxTokens;
  }

  /**
   * Truncate tool output to its budget.
   * Keeps the first portion and last portion, with a truncation marker.
   */
  enforceToolBudget(toolName: string, output: string): string {
    const budget = this.getToolBudget(toolName);
    // Rough estimate: 4 chars ≈ 1 token
    const maxChars = budget * 4;
    if (output.length <= maxChars) return output;

    const keepHead = Math.floor(maxChars * 0.7);
    const keepTail = Math.floor(maxChars * 0.2);
    const truncated = output.length - keepHead - keepTail;

    return (
      output.slice(0, keepHead) +
      `\n\n[...${truncated.toLocaleString()} chars truncated (budget: ${budget} tokens)...]\n\n` +
      output.slice(-keepTail)
    );
  }

  /**
   * Fold a sub-agent's full output into a concise summary.
   * Keeps the first 200 chars as context + truncates the rest.
   */
  foldSubagentResult(agentId: string, fullOutput: string): string {
    if (!this.budget.autoFold) return fullOutput;

    // Short outputs don't need folding
    if (fullOutput.length < 2000) return fullOutput;

    // Keep first ~500 chars (task context) + last ~500 chars (conclusion)
    const head = fullOutput.slice(0, 500);
    const tail = fullOutput.slice(-500);
    const foldedChars = fullOutput.length - 1000;

    return `${head}\n\n[...${foldedChars} chars folded from sub-agent ${agentId}...]\n\n${tail}`;
  }

  /**
   * Check if we should proactively compress before a tool call.
   * Returns true if estimated context usage exceeds the proactive threshold.
   */
  shouldPreCompress(messages: Message[], estimatedOutputTokens: number): boolean {
    const contextWindow = getContextWindow(this.model);
    const currentTokens = estimateMessagesTokens(messages);
    const projected = currentTokens + estimatedOutputTokens;
    return projected / contextWindow > this.budget.proactiveThreshold;
  }

  /**
   * Estimate how many tokens a tool call might produce.
   * Based on historical averages for each tool type.
   */
  estimateToolOutputTokens(toolName: string): number {
    const estimates: Record<string, number> = {
      Bash: 2000,
      Read: 3000,
      Grep: 1500,
      Glob: 500,
      LS: 300,
      Edit: 200,
      Write: 200,
      Agent: 5000,
      Pipeline: 3000,
      WebFetch: 4000,
      WebSearch: 1000,
    };
    return estimates[toolName] ?? 1000;
  }

  /** Whether auto-folding is enabled */
  get autoFoldEnabled(): boolean {
    return this.budget.autoFold;
  }

  /** Get the full budget config */
  get config(): ContextBudget {
    return { ...this.budget };
  }
}
