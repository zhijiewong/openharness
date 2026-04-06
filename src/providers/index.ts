/**
 * Provider factory — create the right provider from a model string.
 */

import type { Provider, ProviderConfig } from "./base.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenRouterProvider } from "./openrouter.js";
import { LlamaCppProvider } from "./llamacpp.js";

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

export { createProviderInstance, guessProviderFromModel };

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
    case "llamacpp":
    case "llama.cpp":
      return new LlamaCppProvider(config);
    case "lmstudio":
    case "lm studio":
      return new LlamaCppProvider({ ...config, baseUrl: config.baseUrl ?? "http://localhost:1234" });
    default:
      // Treat as OpenAI-compatible
      return new OpenAIProvider({ ...config, baseUrl: config.baseUrl ?? `https://api.${name}.com/v1` });
  }
}

function guessProviderFromModel(model: string): string {
  if (model.includes("gpt") || model.startsWith("o3")) return "openai";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("gguf") || model.startsWith("llamacpp")) return "llamacpp";
  if (model.includes("llama") || model.includes("mistral") || model.includes("phi") || model.includes("qwen") || model.includes("gemma") || model.includes("deepseek") || model.includes("codestral") || model.includes("starcoder")) return "ollama";
  return "openai"; // default fallback
}
