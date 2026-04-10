/**
 * Error classification and recovery helpers for the query loop.
 */

export const MAX_CONSECUTIVE_ERRORS = 3;
export const MAX_RATE_LIMIT_RETRIES = 3;

export function isRateLimitError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
}

export function isOverloadError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("503") || msg.includes("overloaded") || msg.includes("service unavailable") || msg.includes("529");
}

export function isPromptTooLongError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("prompt") && msg.includes("long");
}

export function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused");
}
