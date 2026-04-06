/**
 * Base provider interface — every LLM provider implements this.
 */

import type { Message } from "../types/message.js";
import type { StreamEvent } from "../types/events.js";

export type ModelInfo = {
  id: string;
  provider: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  inputCostPerMtok: number;
  outputCostPerMtok: number;
};

export type ProviderConfig = {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
};

export type APIToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

export interface Provider {
  readonly name: string;

  /** Stream response events from the LLM. */
  stream(
    messages: Message[],
    systemPrompt: string,
    tools?: APIToolDef[],
    model?: string,
  ): AsyncGenerator<StreamEvent, void>;

  /** Non-streaming completion (convenience wrapper). */
  complete(
    messages: Message[],
    systemPrompt: string,
    tools?: APIToolDef[],
    model?: string,
  ): Promise<Message>;

  /** List available models. */
  listModels(): ModelInfo[];

  /** Check if provider is reachable. */
  healthCheck(): Promise<boolean>;

  /**
   * Estimate token count for a string.
   * Default implementation uses chars/token ratio from CHARS_PER_TOKEN_BY_PROVIDER.
   * Providers can override for more accurate counting (e.g. tiktoken).
   */
  estimateTokens?(text: string): number;

  /**
   * Look up model info by model ID.
   * Returns undefined if model is not known to this provider.
   */
  getModelInfo?(model: string): ModelInfo | undefined;
}

/** Approximate chars-per-token ratios by provider family */
export const CHARS_PER_TOKEN_BY_PROVIDER: Record<string, number> = {
  anthropic: 3.3,
  openai: 3.5,
  ollama: 3.8,
  llamacpp: 3.8,
  openrouter: 3.5,
};

/** Default token estimator using provider-specific ratio */
export function defaultEstimateTokens(text: string, providerName: string): number {
  const ratio = CHARS_PER_TOKEN_BY_PROVIDER[providerName] ?? 4;
  return Math.ceil(text.length / ratio);
}
