/**
 * Message compression — multi-phase strategies to keep conversation
 * within the context window.
 */

import type { Message } from "../types/message.js";
import type { Provider } from "../providers/base.js";
import { createUserMessage } from "../types/message.js";
import { defaultEstimateTokens } from "../providers/base.js";

const DEFAULT_KEEP_LAST = 10;

/**
 * Semantic importance scoring for messages.
 * Higher score = more important to keep during compression.
 */
export function scoreMessage(msg: Message, index: number, total: number): number {
  if (msg.meta?.pinned) return Infinity;

  let score = 0;

  // Role weight: user intent > tool decisions > assistant text
  if (msg.role === 'user') score += 30;
  else if (msg.role === 'assistant' && msg.toolCalls?.length) score += 20;
  else if (msg.role === 'assistant') score += 10;
  else if (msg.role === 'system') score += 25; // system messages are usually important
  else if (msg.role === 'tool') score += 5;

  // Recency bonus: recent messages get +0 to +20
  const recencyFactor = index / total;
  score += recencyFactor * 20;

  // Content length (longer = more substantive, but cap benefit)
  score += Math.min(msg.content.length / 200, 5);

  // Tool calls indicate decision points
  if (msg.toolCalls?.length) score += msg.toolCalls.length * 3;

  return score;
}

export function makeTokenEstimator(provider: Provider): (text: string) => number {
  if (provider.estimateTokens) return provider.estimateTokens.bind(provider);
  return (text: string) => defaultEstimateTokens(text, provider.name);
}

export function estimateMessagesTokens(
  messages: Message[],
  estimateTokens: (text: string) => number = (t) => Math.ceil(t.length / 4),
): number {
  return messages.reduce((sum, m) => {
    let tokens = estimateTokens(m.content) + 10;
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        tokens += estimateTokens(JSON.stringify(tc.arguments));
      }
    }
    if (m.toolResults) {
      for (const tr of m.toolResults) {
        tokens += estimateTokens(tr.output);
      }
    }
    return sum + tokens;
  }, 0);
}

/**
 * Multi-phase compression: MicroCompact → AutoCompact → Orphan cleanup.
 */
export function compressMessages(messages: Message[], targetTokens: number): Message[] {
  if (messages.length <= 2) return messages;

  const result = [...messages];
  const keepLast = DEFAULT_KEEP_LAST;

  // MicroCompact: Truncate long tool results and assistant messages
  for (let i = 0; i < result.length - keepLast; i++) {
    if (result[i]!.meta?.pinned) continue;
    if (result[i]!.role === "tool" && result[i]!.content.length > 500) {
      const c = result[i]!.content;
      result[i] = { ...result[i]!, content: c.slice(0, 200) + "\n...[truncated]...\n" + c.slice(-100) };
    }
    if (result[i]!.role === "assistant" && result[i]!.content.length > 2000) {
      const c = result[i]!.content;
      result[i] = { ...result[i]!, content: c.slice(0, 500) + "\n...[truncated]...\n" + c.slice(-200) };
    }
  }

  // AutoCompact Phase 1: Replace old tool results with stub
  let toolResultCount = 0;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]!.meta?.pinned) continue;
    if (result[i]!.role === "tool") toolResultCount++;
    if (result[i]!.role === "tool" && toolResultCount > keepLast) {
      result[i] = { ...result[i]!, content: "[previous tool result truncated]" };
    }
  }

  // AutoCompact Phase 2: Drop lowest-importance messages first (importance-aware)
  while (estimateMessagesTokens(result) > targetTokens && result.length > keepLast + 1) {
    // Score all droppable messages and remove the lowest-scored
    let lowestScore = Infinity;
    let lowestIdx = -1;
    for (let i = 0; i < result.length - keepLast; i++) {
      const msg = result[i]!;
      if (msg.role === 'system' || msg.meta?.pinned) continue;
      const score = scoreMessage(msg, i, result.length);
      if (score < lowestScore) {
        lowestScore = score;
        lowestIdx = i;
      }
    }
    if (lowestIdx === -1) break;
    result.splice(lowestIdx, 1);
  }

  // Phase 3: Remove orphaned tool results
  const validCallIds = new Set<string>();
  for (const msg of result) {
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const tc of msg.toolCalls) validCallIds.add(tc.id);
    }
  }
  return result.filter((msg) => {
    if (msg.role !== "tool") return true;
    return (msg.toolResults?.length ?? 0) > 0 &&
           msg.toolResults!.every((tr) => validCallIds.has(tr.callId));
  });
}

/**
 * LLM-assisted summarization of older messages.
 */
export async function summarizeConversation(
  provider: Provider,
  messages: Message[],
  model: string | undefined,
  targetTokens: number,
): Promise<Message[]> {
  const keepRecent = Math.min(6, messages.length - 1);
  const older = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(messages.length - keepRecent);

  if (older.length < 2) return messages;

  const pinned = older.filter(m => m.meta?.pinned);
  const summarizable = older.filter(m => !m.meta?.pinned);

  if (summarizable.length < 2) return messages;

  const olderText = summarizable.map(m => {
    const prefix = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
    let text = `${prefix}: ${m.content.slice(0, 500)}`;
    if (m.toolCalls?.length) {
      text += `\n  [Used tools: ${m.toolCalls.map(tc => tc.toolName).join(', ')}]`;
    }
    return text;
  }).join('\n\n');

  const summaryPrompt = `Summarize this conversation history in 2-4 sentences, preserving key decisions, file paths mentioned, and what was accomplished:\n\n${olderText.slice(0, 3000)}`;

  const summaryResponse = await provider.complete(
    [createUserMessage(summaryPrompt)],
    'You are a conversation summarizer. Be concise and factual. Preserve important details like file paths and decisions.',
    undefined,
    model,
  );

  const summaryMessage: Message = {
    role: 'system',
    content: `[Conversation summary: ${summaryResponse.content}]`,
    uuid: `summary-${Date.now()}`,
    timestamp: Date.now(),
    meta: { isInfo: true },
  };

  return [...pinned, summaryMessage, ...recent];
}
