/**
 * Cost tracking — per-model token and cost tracking with budget enforcement.
 */

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
};

export type CostEvent = {
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

export class CostTracker {
  events: CostEvent[] = [];
  modelUsage: Map<string, ModelUsage> = new Map();
  budget: number;

  constructor(budget = 0) {
    this.budget = budget;
  }

  record(provider: string, model: string, inputTokens: number, outputTokens: number, cost: number): void {
    this.events.push({ timestamp: Date.now(), provider, model, inputTokens, outputTokens, cost });

    const existing = this.modelUsage.get(model) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.costUsd += cost;
    existing.requests += 1;
    this.modelUsage.set(model, existing);
  }

  get totalCost(): number {
    return this.events.reduce((sum, e) => sum + e.cost, 0);
  }

  get totalInputTokens(): number {
    return this.events.reduce((sum, e) => sum + e.inputTokens, 0);
  }

  get totalOutputTokens(): number {
    return this.events.reduce((sum, e) => sum + e.outputTokens, 0);
  }

  isOverBudget(): boolean {
    return this.budget > 0 && this.totalCost >= this.budget;
  }

  formatSummary(): string {
    const lines = [
      `Total cost:   $${this.totalCost.toFixed(4)}`,
      `Total tokens: ${this.totalInputTokens.toLocaleString()} input, ${this.totalOutputTokens.toLocaleString()} output`,
    ];
    if (this.budget > 0) {
      lines.push(`Budget:       $${Math.max(0, this.budget - this.totalCost).toFixed(4)} remaining`);
    }
    if (this.modelUsage.size > 0) {
      lines.push("\nBy model:");
      for (const [model, usage] of this.modelUsage) {
        lines.push(
          `  ${model.padEnd(30)} ${usage.inputTokens.toLocaleString().padStart(8)} in, ${usage.outputTokens.toLocaleString().padStart(8)} out  ($${usage.costUsd.toFixed(4)})`,
        );
      }
    }
    return lines.join("\n");
  }
}

/** Model pricing: [input_cost_per_mtok, output_cost_per_mtok] */
export const MODEL_PRICING: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "o3-mini": [1.1, 4.4],
  "o3": [10.0, 40.0],
  "claude-sonnet-4-6": [3.0, 15.0],
  "claude-haiku-4-5": [0.8, 4.0],
  "claude-opus-4-6": [15.0, 75.0],
  "deepseek-chat": [0.14, 0.28],
  "deepseek-coder": [0.14, 0.28],
  "qwen-turbo": [0.2, 0.6],
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing[0] + (outputTokens / 1_000_000) * pricing[1];
}

/** Context window sizes in tokens per model (approximate) */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o":            128_000,
  "gpt-4o-mini":       128_000,
  "o3-mini":           200_000,
  "o3":                200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5":  200_000,
  "claude-opus-4-6":   200_000,
  "deepseek-chat":     64_000,
  "deepseek-coder":    64_000,
  "qwen-turbo":        131_072,
};

/** Returns context usage as a fraction 0–1, or null if model unknown */
export function contextUsage(model: string, inputTokens: number): number | null {
  const limit = MODEL_CONTEXT_LIMITS[model];
  if (!limit) return null;
  return inputTokens / limit;
}
