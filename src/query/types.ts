/**
 * Shared types for the query loop sub-modules.
 */

import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { Message } from "../types/message.js";
import type { AskUserFn, PermissionMode } from "../types/permissions.js";

export type QueryConfig = {
  provider: Provider;
  tools: Tools;
  systemPrompt: string;
  permissionMode: PermissionMode;
  askUser?: AskUserFn;
  askUserQuestion?: (question: string, options?: string[]) => Promise<string>;
  maxTurns?: number;
  maxCost?: number;
  model?: string;
  abortSignal?: AbortSignal;
  /** Working directory for tool execution (defaults to process.cwd()) */
  workingDir?: string;
  /** Auto-commit after each file-modifying tool */
  gitCommitPerTool?: boolean;
  /** For sub-agent invocations: the agent role name (feeds into the model router). */
  role?: string;
};

export type TransitionReason = "next_turn" | "retry_network" | "retry_prompt_too_long" | "retry_max_output_tokens";

export type QueryLoopState = {
  messages: Message[];
  turn: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  consecutiveErrors: number;
  transition?: TransitionReason;
  promptTooLongRetries?: number;
  /** Track consecutive compression failures for circuit breaker */
  compressionFailures?: number;
};
