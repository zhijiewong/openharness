/**
 * FallbackProvider — wraps a primary provider with fallback chain.
 *
 * When the primary provider fails (rate limit, 5xx, auth), transparently
 * tries the next provider in the chain. Matches Hermes Agent pattern.
 */

import type { APIToolDef, ModelInfo, Provider } from "./base.js";
import type { StreamEvent } from "../types/events.js";
import type { Message } from "../types/message.js";

export type FallbackConfig = {
  provider: Provider;
  model?: string;
};

/**
 * Create a provider that falls back to alternatives on failure.
 * The primary provider is tried first. If it fails with a retriable error,
 * each fallback is tried in order.
 */
export function createFallbackProvider(
  primary: Provider,
  fallbacks: FallbackConfig[],
): Provider & { activeFallback: string | null } {
  let activeFallback: string | null = null;

  return {
    name: primary.name,
    activeFallback,

    async *stream(messages, systemPrompt, tools?, model?) {
      // Try primary first
      try {
        yield* primary.stream(messages, systemPrompt, tools, model);
        activeFallback = null;
        return;
      } catch (err) {
        if (!isRetriableError(err)) throw err;
      }

      // Try fallbacks in order
      for (const fb of fallbacks) {
        try {
          activeFallback = fb.provider.name;
          yield* fb.provider.stream(messages, systemPrompt, tools, fb.model ?? model);
          return;
        } catch (err) {
          if (!isRetriableError(err)) throw err;
        }
      }

      // All failed
      activeFallback = null;
      throw new Error("All providers failed (primary + fallbacks)");
    },

    async complete(messages, systemPrompt, tools?, model?) {
      try {
        const result = await primary.complete(messages, systemPrompt, tools, model);
        activeFallback = null;
        return result;
      } catch (err) {
        if (!isRetriableError(err)) throw err;
      }

      for (const fb of fallbacks) {
        try {
          activeFallback = fb.provider.name;
          return await fb.provider.complete(messages, systemPrompt, tools, fb.model ?? model);
        } catch (err) {
          if (!isRetriableError(err)) throw err;
        }
      }

      activeFallback = null;
      throw new Error("All providers failed (primary + fallbacks)");
    },

    listModels() {
      return primary.listModels();
    },

    async healthCheck() {
      if (await primary.healthCheck()) return true;
      for (const fb of fallbacks) {
        if (await fb.provider.healthCheck()) return true;
      }
      return false;
    },

    estimateTokens: primary.estimateTokens?.bind(primary),
    getModelInfo: primary.getModelInfo?.bind(primary),
  };
}

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("overloaded") ||
    msg.includes("503") ||
    msg.includes("529") ||
    msg.includes("service unavailable") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("401") ||
    msg.includes("403")
  );
}
