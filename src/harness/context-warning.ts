/**
 * Context window warning — shared between cell renderer and Ink REPL.
 */

import type { Message } from '../types/message.js';
import { getContextWindow } from './cost.js';

/** Estimate total tokens from messages (incremental-friendly) */
export function estimateMessageTokens(messages: Message[], startFrom = 0): number {
  let total = 0;
  for (let i = startFrom; i < messages.length; i++) {
    const m = messages[i]!;
    total += Math.ceil(m.content.length / 3.5);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += Math.ceil(JSON.stringify(tc.arguments).length / 3.5);
      }
    }
    if (m.toolResults) {
      for (const tr of m.toolResults) {
        total += Math.ceil(tr.output.length / 3.5);
      }
    }
  }
  return total;
}

/** Compute context warning if usage exceeds 75% */
export function getContextWarning(
  estimatedTokens: number,
  model: string,
): { text: string; critical: boolean } | null {
  const window = getContextWindow(model);
  const usage = window > 0 ? estimatedTokens / window : 0;
  if (usage >= 0.75) {
    return {
      text: `⚠ Context ~${Math.round(usage * 100)}% full — consider /compact`,
      critical: usage >= 0.9,
    };
  }
  return null;
}
