/**
 * Agent loop — the core LLM-to-Tool orchestration cycle.
 *
 * This is the coordinator that delegates to sub-modules:
 * - compress.ts — message compression strategies
 * - tools.ts — tool execution, permission checking, batching
 * - errors.ts — error classification and recovery
 * - types.ts — shared types
 */

import { DeferredTool } from "../DeferredTool.js";
import { getContextWindow } from "../harness/cost.js";
import { StreamingToolExecutor } from "../services/StreamingToolExecutor.js";
import type { ToolContext } from "../Tool.js";
import { toolToAPIFormat } from "../Tool.js";
import type { StreamEvent } from "../types/events.js";
import type { ToolCall } from "../types/message.js";
import { createAssistantMessage, createToolResultMessage, createUserMessage } from "../types/message.js";
import { compressMessages, estimateMessagesTokens, makeTokenEstimator, summarizeConversation } from "./compress.js";
import { ContextManager } from "./context-manager.js";
import {
  isNetworkError,
  isOverloadError,
  isPromptTooLongError,
  isRateLimitError,
  MAX_CONSECUTIVE_ERRORS,
  MAX_RATE_LIMIT_RETRIES,
} from "./errors.js";
import { executeToolCalls } from "./tools.js";
import type { QueryConfig, QueryLoopState } from "./types.js";

export { compressMessages } from "./compress.js";
// Re-export types and compression for external consumers
export type { QueryConfig, QueryLoopState } from "./types.js";

const DEFAULT_MAX_TURNS = 50;

export async function* query(
  userMessage: string,
  config: QueryConfig,
  existingMessages: import("../types/message.js").Message[] = [],
): AsyncGenerator<StreamEvent, void> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolContext: ToolContext = {
    workingDir: config.workingDir ?? process.cwd(),
    abortSignal: config.abortSignal,
    provider: config.provider,
    model: config.model,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
    permissionMode: config.permissionMode,
    askUserQuestion: config.askUserQuestion,
  };
  const estimateTokens = makeTokenEstimator(config.provider);
  const contextManager = new ContextManager(undefined, config.model);

  // Check provider capabilities
  const modelInfo = config.provider.getModelInfo?.(config.model ?? "");
  const toolsSupported = !modelInfo || modelInfo.supportsTools;
  const apiTools = toolsSupported ? config.tools.map(toolToAPIFormat) : undefined;

  let toolPrompts = toolsSupported ? config.tools.map((t) => t.prompt()).join("\n\n") : "";

  // Hint about deferred tools available via ToolSearch
  if (toolsSupported) {
    const deferredCount = config.tools.filter((t) => t instanceof DeferredTool && !t.activated).length;
    if (deferredCount > 0) {
      toolPrompts += `\n\n[${deferredCount} additional tools available — use ToolSearch to discover them]`;
    }
  }

  let fullSystemPrompt = toolPrompts
    ? `${config.systemPrompt}\n\n# Available Tools\n\n${toolPrompts}`
    : config.systemPrompt;

  // Auto-trigger skills matching user message
  try {
    const { findTriggeredSkills } = await import("../harness/plugins.js");
    const triggered = findTriggeredSkills(userMessage);
    if (triggered.length > 0) {
      const hints = triggered.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
      fullSystemPrompt += `\n\n# Suggested Skills\nThese skills match your request. Use Skill tool to load them:\n${hints}`;
    }
  } catch { /* skills optional */ }

  // Track memory version for live injection
  let lastMemoryVer = 0;
  try {
    const { memoryVersion } = await import("../harness/memory.js");
    lastMemoryVer = memoryVersion();
  } catch { /* ignore */ }

  const state: QueryLoopState = {
    messages: [...existingMessages, createUserMessage(userMessage)],
    turn: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    consecutiveErrors: 0,
  };

  // ── Main loop ──
  while (state.turn < maxTurns) {
    state.turn++;

    if (config.abortSignal?.aborted) {
      yield { type: "turn_complete", reason: "aborted" };
      return;
    }

    if (config.maxCost && config.maxCost > 0 && state.totalCost >= config.maxCost) {
      yield { type: "error", message: `Budget exceeded: $${state.totalCost.toFixed(4)}` };
      yield { type: "turn_complete", reason: "budget_exceeded" };
      return;
    }

    // Context window management
    const contextWindow = getContextWindow(config.model);
    const estimatedTokens = estimateMessagesTokens(state.messages, estimateTokens);
    if (estimatedTokens > contextWindow * 0.8) {
      state.messages = compressMessages(state.messages, Math.floor(contextWindow * 0.6));
      const afterBasic = estimateMessagesTokens(state.messages, estimateTokens);
      if (afterBasic > contextWindow * 0.7 && state.messages.length > 4) {
        try {
          state.messages = await summarizeConversation(
            config.provider,
            state.messages,
            config.model,
            Math.floor(contextWindow * 0.5),
          );
          yield { type: "error", message: "Context compressed with LLM summarization." };
        } catch {
          /* continue with basic compression */
        }
      }
    }

    // ── Dynamic prompt: refresh memories if changed, inject warnings ──
    try {
      const { memoryVersion, loadActiveMemories, memoriesToPrompt } = await import("../harness/memory.js");
      const currentVer = memoryVersion();
      if (currentVer > lastMemoryVer) {
        const fresh = memoriesToPrompt(loadActiveMemories());
        // Replace or append memory section in fullSystemPrompt
        if (fullSystemPrompt.includes("# Remembered Context")) {
          fullSystemPrompt = fullSystemPrompt.replace(/# Remembered Context[\s\S]*?(?=\n# |$)/, fresh);
        } else if (fresh) {
          fullSystemPrompt += `\n\n${fresh}`;
        }
        lastMemoryVer = currentVer;
      }
    } catch { /* memory refresh optional */ }

    let turnPrompt = fullSystemPrompt;
    if (config.maxCost && config.maxCost > 0) {
      const pct = state.totalCost / config.maxCost;
      if (pct >= 0.9) {
        turnPrompt += `\n\n⚠️ BUDGET CRITICAL: Only $${(config.maxCost - state.totalCost).toFixed(4)} remaining. Provide final response NOW.`;
      } else if (pct >= 0.7) {
        turnPrompt += `\n\n⚠️ BUDGET WARNING: ${Math.round((1 - pct) * 100)}% budget remaining. Start consolidating.`;
      }
    }
    if (state.turn >= maxTurns * 0.9 && maxTurns > 1) {
      turnPrompt += `\n\n⚠️ TURN LIMIT: ${maxTurns - state.turn} turn(s) remaining. Wrap up.`;
    }

    // ── LLM call with streaming ──
    let assistantContent = "";
    const toolCalls: ToolCall[] = [];
    let streamError: Error | null = null;

    const streamingExecutor = new StreamingToolExecutor(
      config.tools,
      toolContext,
      config.permissionMode,
      config.askUser,
      config.abortSignal,
    );

    try {
      for await (const event of config.provider.stream(state.messages, turnPrompt, apiTools, config.model)) {
        if (config.abortSignal?.aborted) break;

        switch (event.type) {
          case "text_delta":
            assistantContent += event.content;
            yield event;
            break;
          case "tool_call_start":
            toolCalls.push({ id: event.callId, toolName: event.toolName, arguments: {} });
            yield event;
            break;
          case "tool_call_complete": {
            const tc = toolCalls.find((t) => t.id === event.callId);
            if (tc) {
              const idx = toolCalls.indexOf(tc);
              toolCalls[idx] = { ...tc, arguments: event.arguments };
            }
            if (streamingExecutor) {
              streamingExecutor.addTool({ id: event.callId, toolName: event.toolName, arguments: event.arguments });
            }
            break;
          }
          case "cost_update":
            state.totalCost += event.cost;
            state.totalInputTokens += event.inputTokens;
            state.totalOutputTokens += event.outputTokens;
            yield event;
            break;
          case "error":
            yield event;
            break;
        }
      }
      state.consecutiveErrors = 0;
    } catch (err) {
      streamError = err instanceof Error ? err : new Error(String(err));
      state.consecutiveErrors++;

      // Circuit breaker
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        yield {
          type: "error",
          message: `Too many consecutive errors (${state.consecutiveErrors}): ${streamError.message}`,
        };
        yield { type: "turn_complete", reason: "error" };
        return;
      }

      // Error recovery cascade
      if (isRateLimitError(streamError) || isOverloadError(streamError)) {
        const attempt = state.consecutiveErrors;
        const isOverload = isOverloadError(streamError);
        if (attempt <= MAX_RATE_LIMIT_RETRIES) {
          const baseRetry = 2 ** attempt * (isOverload ? 2 : 1);
          const retryIn = baseRetry * (0.5 + Math.random());
          yield { type: "rate_limited", retryIn: Math.round(retryIn), attempt };
          await new Promise((r) => setTimeout(r, retryIn * 1000));
          continue;
        }
        yield {
          type: "error",
          message: `${isOverload ? "Server overloaded" : "Rate limit exceeded"} after ${MAX_RATE_LIMIT_RETRIES} retries.`,
        };
        yield { type: "turn_complete", reason: "error" };
        return;
      }

      if (isPromptTooLongError(streamError)) {
        state.promptTooLongRetries = (state.promptTooLongRetries ?? 0) + 1;
        if (state.promptTooLongRetries > 2) {
          yield { type: "error", message: "Context still too long after 2 compression attempts." };
          yield { type: "turn_complete", reason: "error" };
          return;
        }
        state.messages = compressMessages(state.messages, Math.floor(contextWindow * 0.5));
        state.transition = "retry_prompt_too_long";
        yield { type: "error", message: "Context too long, compressing history..." };
        continue;
      }

      if (isNetworkError(streamError)) {
        state.transition = "retry_network";
        const delay = 1000 * 2 ** (state.consecutiveErrors - 1);
        yield { type: "error", message: `Network error, retrying in ${delay / 1000}s...` };
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      yield { type: "error", message: streamError.message };
      yield { type: "turn_complete", reason: "error" };
      return;
    }

    if (config.abortSignal?.aborted) {
      yield { type: "turn_complete", reason: "aborted" };
      return;
    }

    if (assistantContent === "" && toolCalls.length === 0) {
      yield {
        type: "error",
        message: "No response received. Check that your model server is running and the model name is correct.",
      };
      return;
    }

    state.messages.push(createAssistantMessage(assistantContent, toolCalls.length > 0 ? toolCalls : undefined));

    if (toolCalls.length === 0) {
      yield { type: "turn_complete", reason: "completed" };
      return;
    }

    // Collect streaming tool results
    await streamingExecutor.waitForAll();
    const completedResults = [...streamingExecutor.getCompletedResults()];
    const executedIds = new Set(completedResults.map((r) => r.toolCall.id));

    for (const { callId, chunk } of streamingExecutor.outputChunks) {
      yield { type: "tool_output_delta", callId, chunk };
    }

    for (const { toolCall: tc, result } of completedResults) {
      yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
      // Apply context budget to tool output
      const budgetedOutput = contextManager.enforceToolBudget(tc.toolName, result.output);
      state.messages.push(createToolResultMessage({ callId: tc.id, output: budgetedOutput, isError: result.isError }));
    }

    // Execute remaining tools not started during streaming
    const remaining = toolCalls.filter((tc) => !executedIds.has(tc.id));
    if (remaining.length > 0) {
      yield* executeToolCalls(remaining, config.tools, toolContext, config.permissionMode, config.askUser, state);
    }

    state.transition = "next_turn";
  }

  yield { type: "turn_complete", reason: "max_turns" };
}
