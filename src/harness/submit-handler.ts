/**
 * Shared submit/input handler — processes user input before sending to LLM.
 * Used by both cell renderer REPL and Ink REPL.
 */

import type { Message } from '../types/message.js';
import type { PermissionMode } from '../types/permissions.js';
import { createUserMessage, createInfoMessage } from '../types/message.js';
import { processSlashCommand, type CommandContext } from '../commands/index.js';
import { cybergotchiEvents } from '../cybergotchi/events.js';
import { resolveMcpMention } from '../mcp/loader.js';
import type { CompanionConfig } from '../cybergotchi/types.js';
import type { CostTracker } from './cost.js';

export type SubmitContext = {
  messages: Message[];
  currentModel: string;
  providerName: string;
  permissionMode: PermissionMode;
  cost: CostTracker;
  sessionId: string;
  companionConfig: CompanionConfig | null;
};

export type SubmitResult = {
  /** Whether the input was fully handled (don't send to LLM) */
  handled: boolean;
  /** Updated messages array */
  messages: Message[];
  /** Prompt to send to LLM (may differ from input due to @mentions) */
  prompt?: string;
  /** New model if changed by slash command */
  newModel?: string;
  /** Whether vim mode was toggled */
  vimToggled?: boolean;
  /** Whether fast mode was toggled */
  fastModeToggled?: boolean;
};

/**
 * Process user input: handle exit, companion mentions, slash commands,
 * @mentions, and prepare the prompt for the LLM.
 */
export async function handleUserInput(
  input: string,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  const trimmed = input.trim();
  let messages = ctx.messages;

  // Companion address
  if (ctx.companionConfig) {
    const name = ctx.companionConfig.soul.name.toLowerCase();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith(`@${name}`) || lower.startsWith(`${name},`) || lower.startsWith(`${name} `)) {
      cybergotchiEvents.emit('cybergotchi', { type: 'userAddressed', text: trimmed });
      return { handled: true, messages };
    }
  }

  // Vim toggle
  if (trimmed === '/vim') {
    return { handled: true, messages, vimToggled: true };
  }

  // Slash commands
  if (trimmed.startsWith('/')) {
    const cmdCtx: CommandContext = {
      messages,
      model: ctx.currentModel,
      providerName: ctx.providerName,
      permissionMode: ctx.permissionMode,
      totalCost: ctx.cost.totalCost,
      totalInputTokens: ctx.cost.totalInputTokens,
      totalOutputTokens: ctx.cost.totalOutputTokens,
      sessionId: ctx.sessionId,
    };
    const result = processSlashCommand(trimmed, cmdCtx);
    if (result) {
      if (result.clearMessages) messages = [];
      if (result.compactedMessages) messages = result.compactedMessages;
      if (result.output) messages = [...messages, createInfoMessage(result.output)];

      if (result.toggleFastMode) {
        return { handled: true, messages, fastModeToggled: true };
      }
      if (result.handled && !result.prependToPrompt) {
        return {
          handled: true,
          messages,
          newModel: result.newModel ?? undefined,
        };
      }
      if (result.prependToPrompt) {
        messages = [...messages, createUserMessage(input)];
        return {
          handled: false,
          messages,
          prompt: result.prependToPrompt,
          newModel: result.newModel ?? undefined,
        };
      }
    }
  }

  // Normal prompt — add user message
  messages = [...messages, createUserMessage(input)];

  // Resolve @mentions
  let resolvedInput = input;
  const mentionPattern = /@(\w[\w.-]*)/g;
  const mentions = [...input.matchAll(mentionPattern)].map(m => m[1]!);
  const companionName = ctx.companionConfig?.soul?.name?.toLowerCase();
  for (const mention of mentions) {
    if (companionName && mention.toLowerCase() === companionName) continue;
    try {
      const content = await resolveMcpMention(mention);
      if (content) resolvedInput += `\n\n[Resource @${mention}]:\n${content.slice(0, 5000)}`;
    } catch { /* ignore */ }
  }

  return { handled: false, messages, prompt: resolvedInput };
}
