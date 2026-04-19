/**
 * FallbackProvider — wraps a primary provider with fallback chain.
 *
 * When the primary provider fails (rate limit, 5xx, network), transparently
 * tries the next provider in the chain. Matches Hermes Agent pattern.
 *
 * Design notes:
 * - Streaming fallback only activates if primary fails BEFORE yielding events.
 *   Once events are streaming, partial output can't be un-sent, so we don't
 *   catch mid-stream errors (they propagate to the caller for retry).
 * - 401/403 are NOT retriable (they're permanent auth failures). Different
 *   providers have different keys, so this is handled at the config level.
 */

import type { Provider } from "./base.js";

export type FallbackConfig = {
  provider: Provider;
  model?: string;
};

/**
 * Create a provider that falls back to alternatives on failure.
 * The primary provider is tried first. If it fails with a retriable error
 * BEFORE streaming begins, each fallback is tried in order.
 */
export function createFallbackProvider(
  primary: Provider,
  fallbacks: FallbackConfig[],
): Provider & { readonly activeFallback: string | null } {
  let _activeFallback: string | null = null;

  const obj: Provider & { readonly activeFallback: string | null } = {
    name: primary.name,

    get activeFallback() {
      return _activeFallback;
    },

    async *stream(messages, systemPrompt, tools?, model?) {
      // Collect first event to detect early failure vs mid-stream failure.
      // If the provider fails before ANY event, try fallback.
      // If it fails mid-stream, propagate the error (partial output already sent).
      const providers: Array<{ provider: Provider; model?: string }> = [
        { provider: primary, model },
        ...fallbacks.map((fb) => ({ provider: fb.provider, model: fb.model ?? model })),
      ];

      for (let i = 0; i < providers.length; i++) {
        const p = providers[i]!;
        let hasYielded = false;
        try {
          for await (const event of p.provider.stream(messages, systemPrompt, tools, p.model)) {
            hasYielded = true;
            yield event;
          }
          if (i > 0) {
            console.warn(`[provider] fell back from ${primary.name} to ${p.provider.name}`);
            _activeFallback = p.provider.name;
          } else {
            _activeFallback = null;
          }
          return;
        } catch (err) {
          // Mid-stream failure OR non-retriable OR fallback error: propagate.
          if (i > 0 || !isRetriableError(err) || hasYielded) throw err;
          // Pre-stream retriable failure on primary only: try next provider.
          _activeFallback = null;
        }
      }

      _activeFallback = null;
      throw new Error("All providers failed (primary + fallbacks)");
    },

    async complete(messages, systemPrompt, tools?, model?) {
      // complete() is atomic — safe to retry with any provider
      const providers: Array<{ provider: Provider; model?: string }> = [
        { provider: primary, model },
        ...fallbacks.map((fb) => ({ provider: fb.provider, model: fb.model ?? model })),
      ];

      for (let i = 0; i < providers.length; i++) {
        const p = providers[i]!;
        try {
          const result = await p.provider.complete(messages, systemPrompt, tools, p.model);
          if (i > 0) {
            console.warn(`[provider] fell back from ${primary.name} to ${p.provider.name}`);
            _activeFallback = p.provider.name;
          } else {
            _activeFallback = null;
          }
          return result;
        } catch (err) {
          if (!isRetriableError(err)) throw err;
        }
      }

      _activeFallback = null;
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

  return obj;
}

/** Check if an error is worth retrying with a different provider */
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
    msg.includes("timeout")
    // Note: 401/403 are NOT retriable — they're permanent auth failures.
    // Different providers use different API keys, so auth issues don't
    // benefit from fallback. The user should fix their API key.
  );
}
