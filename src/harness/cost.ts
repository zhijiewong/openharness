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
  o3: [10.0, 40.0],
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

/** Context window sizes — prefix-matched, most-specific prefix first */
const CONTEXT_WINDOW_PREFIXES: Array<[string, number]> = [
  // Anthropic
  ["claude-", 200_000],
  // OpenAI
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-3.5", 16_000],
  ["o1", 200_000],
  ["o3", 200_000],
  // Llama 3.x
  ["llama3", 128_000],
  ["llama-3", 128_000],
  // Qwen
  ["qwen2.5", 128_000],
  ["qwen2", 128_000],
  ["qwen-turbo", 131_072],
  // Mistral / Mixtral
  ["mistral", 32_000],
  ["mixtral", 32_000],
  // DeepSeek
  ["deepseek", 64_000],
  // Phi
  ["phi", 128_000],
  // Gemma
  ["gemma3", 128_000],
  ["gemma2", 8_192],
  ["gemma", 8_192],
];

/** Returns the context window size in tokens for a given model name. */
export function getContextWindow(model?: string): number {
  if (!model) return 8_192;
  const lower = model.toLowerCase();
  for (const [prefix, window] of CONTEXT_WINDOW_PREFIXES) {
    if (lower.startsWith(prefix)) return window;
  }
  return 32_768;
}

/** Returns context usage as a fraction 0–1 */
export function contextUsage(model: string, inputTokens: number): number {
  const window = getContextWindow(model);
  return inputTokens / window;
}
