/**
 * Shared types for the slash command system.
 */

import type { Message } from "../types/message.js";

export type CommandResult = {
  /** Text output to display */
  output: string;
  /** If true, don't send to LLM */
  handled: boolean;
  /** If set, clear messages */
  clearMessages?: boolean;
  /** If set, update model */
  newModel?: string;
  /** If set, replace messages with compacted version */
  compactedMessages?: Message[];
  /** If true, open the cybergotchi setup UI */
  openCybergotchiSetup?: boolean;
  /** If set, resume this session ID */
  resumeSessionId?: string;
  /** If set, prepend this text to the user's prompt before sending to LLM */
  prependToPrompt?: string;
  /** If set, toggle fast mode */
  toggleFastMode?: boolean;
};

export type CommandHandler = (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;

export type CommandContext = {
  messages: Message[];
  model: string;
  providerName: string;
  permissionMode: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionId: string;
};
