/**
 * Provider factory — create the right provider from a model string.
 */

import type { Provider, ProviderConfig } from "./base.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenRouterProvider } from "./openrouter.js";

/**
 * Create a provider from a model string like "ollama/llama3" or "gpt-4o".
 */
export async function createProvider(
  modelArg?: string,
  overrides?: Partial<ProviderConfig>,
): Promise<{ provider: Provider; model: string }> {
  let providerName = "ollama";
  let model = "llama3";

  if (modelArg) {
    if (modelArg.includes("/")) {
      const [p, m] = modelArg.split("/", 2);
      providerName = p!;
      model = m!;
    } else {
      model = modelArg;
      providerName = guessProviderFromModel(model);
    }
  }

  const config: ProviderConfig = {
    name: providerName,
    apiKey: process.env[`${providerName.toUpperCase()}_API_KEY`],
    defaultModel: model,
    ...overrides,
  };

  const provider = createProviderInstance(providerName, config);
  return { provider, model };
}

export { createProviderInstance };

function createProviderInstance(name: string, config: ProviderConfig): Provider {
  switch (name) {
    case "ollama":
      return new OllamaProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "openrouter":
      return new OpenRouterProvider(config);
    default:
      // Treat as OpenAI-compatible
      return new OpenAIProvider({ ...config, baseUrl: config.baseUrl ?? `https://api.${name}.com/v1` });
  }
}

function guessProviderFromModel(model: string): string {
  if (model.includes("gpt") || model.startsWith("o3")) return "openai";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("llama") || model.includes("mistral") || model.includes("phi")) return "ollama";
  return "openai"; // default fallback
}
