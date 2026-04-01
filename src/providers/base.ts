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
}
