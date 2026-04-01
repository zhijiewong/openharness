/**
 * Agent loop — the core LLM-to-Tool orchestration cycle.
 *
 * Core agent loop architecture:
 * - while(true) state machine with explicit transitions
 * - Error recovery with ordered fallbacks and circuit breaker
 * - Context window management with message compression
 * - Tool result budgeting (cap large outputs)
 * - Permission blocking (awaits user approval before tool execution)
 */

import type { Tool, ToolContext, ToolResult, Tools } from "./Tool.js";
import { findToolByName, toolToAPIFormat } from "./Tool.js";
import type { StreamEvent } from "./types/events.js";
import type { Message, ToolCall } from "./types/message.js";
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "./types/message.js";
import type { AskUserFn, PermissionMode } from "./types/permissions.js";
import { checkPermission } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";
import { StreamingToolExecutor } from "./services/StreamingToolExecutor.js";

// ── Configuration ──

export type QueryConfig = {
  provider: Provider;
  tools: Tools;
  systemPrompt: string;
  permissionMode: PermissionMode;
  askUser?: AskUserFn;
  maxTurns?: number;
  maxCost?: number;
  model?: string;
  abortSignal?: AbortSignal;
};

// ── Loop State Machine ──

type TransitionReason =
  | "next_turn"
  | "retry_network"
  | "retry_prompt_too_long"
  | "retry_max_output_tokens";

type QueryLoopState = {
  messages: Message[];
  turn: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  consecutiveErrors: number;
  transition?: TransitionReason;
};

const DEFAULT_MAX_TURNS = 50;
const MAX_CONSECUTIVE_ERRORS = 3;
const MAX_TOOL_RESULT_CHARS = 100_000; // 100KB cap per tool result
const CHARS_PER_TOKEN = 4; // rough estimation

// ── Main Entry ──

export async function* query(
  userMessage: string,
  config: QueryConfig,
  existingMessages: Message[] = [],
): AsyncGenerator<StreamEvent, void> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolContext: ToolContext = { workingDir: process.cwd(), abortSignal: config.abortSignal };
  const toolPrompts = config.tools.map((t) => t.prompt()).join("\n\n");
  const fullSystemPrompt = config.systemPrompt + "\n\n# Available Tools\n\n" + toolPrompts;
  const apiTools = config.tools.map(toolToAPIFormat);

  const state: QueryLoopState = {
    messages: [...existingMessages, createUserMessage(userMessage)],
    turn: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    consecutiveErrors: 0,
  };

  // ── while(true) state machine ──
  while (state.turn < maxTurns) {
    state.turn++;

    // Abort check
    if (config.abortSignal?.aborted) {
      yield { type: "turn_complete", reason: "aborted" };
      return;
    }

    // Budget check
    if (config.maxCost && config.maxCost > 0 && state.totalCost >= config.maxCost) {
      yield { type: "error", message: `Budget exceeded: $${state.totalCost.toFixed(4)}` };
      yield { type: "turn_complete", reason: "budget_exceeded" };
      return;
    }

    // Context window management — compress if needed
    const estimatedTokens = estimateMessagesTokens(state.messages);
    const contextWindow = getContextWindow(config.model);
    if (estimatedTokens > contextWindow * 0.8) {
      state.messages = compressMessages(state.messages, Math.floor(contextWindow * 0.6));
    }

    // ── LLM Call with error recovery ──
    let assistantContent = "";
    const toolCalls: ToolCall[] = [];
    let streamError: Error | null = null;

    // Streaming tool executor — tools start during LLM streaming
    const streamingExecutor = new StreamingToolExecutor(
      config.tools, toolContext, config.permissionMode, config.askUser,
    );

    try {
      for await (const event of config.provider.stream(
        state.messages,
        fullSystemPrompt,
        apiTools,
        config.model,
      )) {
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
            // Start executing tool immediately (streaming execution)
            if (streamingExecutor) {
              streamingExecutor.addTool({
                id: event.callId,
                toolName: event.toolName,
                arguments: event.arguments,
              });
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

      // Reset error counter on success
      state.consecutiveErrors = 0;

    } catch (err) {
      streamError = err instanceof Error ? err : new Error(String(err));
      state.consecutiveErrors++;

      // Circuit breaker
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        yield { type: "error", message: `Too many consecutive errors (${state.consecutiveErrors}): ${streamError.message}` };
        yield { type: "turn_complete", reason: "error" };
        return;
      }

      // Error recovery cascade
      const errorMsg = streamError.message.toLowerCase();

      if (errorMsg.includes("prompt") && errorMsg.includes("long")) {
        // Prompt too long → compress and retry
        state.messages = compressMessages(state.messages, Math.floor(contextWindow * 0.5));
        state.transition = "retry_prompt_too_long";
        yield { type: "error", message: "Context too long, compressing history..." };
        continue;
      }

      if (errorMsg.includes("network") || errorMsg.includes("fetch") || errorMsg.includes("econnrefused")) {
        // Network error → retry with backoff
        state.transition = "retry_network";
        const delay = 1000 * Math.pow(2, state.consecutiveErrors - 1);
        yield { type: "error", message: `Network error, retrying in ${delay / 1000}s...` };
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Other error → surface and stop
      yield { type: "error", message: streamError.message };
      yield { type: "turn_complete", reason: "error" };
      return;
    }

    // Abort check after stream
    if (config.abortSignal?.aborted) {
      yield { type: "turn_complete", reason: "aborted" };
      return;
    }

    // Add assistant message to history
    state.messages.push(
      createAssistantMessage(assistantContent, toolCalls.length > 0 ? toolCalls : undefined),
    );

    // No tool calls → done
    if (toolCalls.length === 0) {
      yield { type: "turn_complete", reason: "completed" };
      return;
    }

    // ── Collect streaming tool results ──
    await streamingExecutor.waitForAll();

    const completedResults = [...streamingExecutor.getCompletedResults()];
    const executedIds = new Set(completedResults.map(r => r.toolCall.id));

    for (const { toolCall: tc, result } of completedResults) {
      yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
      state.messages.push(createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }));
    }

    // Execute any tools that weren't started during streaming
    const remaining = toolCalls.filter(tc => !executedIds.has(tc.id));
    if (remaining.length > 0) {
      yield* executeToolCalls(remaining, config.tools, toolContext, config.permissionMode, config.askUser, state);
    }

    state.transition = "next_turn";
  }

  yield { type: "turn_complete", reason: "max_turns" };
}

// ── Tool Execution ──

async function* executeToolCalls(
  toolCalls: ToolCall[],
  tools: Tools,
  context: ToolContext,
  permissionMode: PermissionMode,
  askUser?: AskUserFn,
  state?: QueryLoopState,
): AsyncGenerator<StreamEvent, void> {
  const batches = partitionToolCalls(toolCalls, tools);

  // tool_call_start already yielded by the provider stream — only yield tool_call_end here
  for (const batch of batches) {
    if (batch.concurrent) {
      const results = await Promise.all(
        batch.calls.map((tc) => executeSingleTool(tc, tools, context, permissionMode, askUser)),
      );
      for (let i = 0; i < batch.calls.length; i++) {
        const tc = batch.calls[i]!;
        const result = results[i]!;
        yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
        state?.messages.push(createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }));
      }
    } else {
      for (const tc of batch.calls) {
        const result = await executeSingleTool(tc, tools, context, permissionMode, askUser);
        yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
        state?.messages.push(createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }));
      }
    }
  }
}

async function executeSingleTool(
  toolCall: ToolCall,
  tools: Tools,
  context: ToolContext,
  permissionMode: PermissionMode,
  askUser?: AskUserFn,
): Promise<ToolResult> {
  const tool = findToolByName(tools, toolCall.toolName);
  if (!tool) {
    return { output: `Error: Unknown tool '${toolCall.toolName}'`, isError: true };
  }

  const parsed = tool.inputSchema.safeParse(toolCall.arguments);
  if (!parsed.success) {
    return { output: `Validation error: ${parsed.error.message}`, isError: true };
  }

  // Permission check — BLOCKS until user responds
  const perm = checkPermission(permissionMode, tool.riskLevel, tool.isReadOnly(parsed.data));
  if (!perm.allowed) {
    if (perm.reason === "needs-approval" && askUser) {
      const allowed = await askUser(tool.name, JSON.stringify(toolCall.arguments).slice(0, 200));
      if (!allowed) {
        return { output: "Permission denied by user.", isError: true };
      }
      // User approved — fall through to execution
    } else {
      return { output: `Permission denied: ${perm.reason}`, isError: true };
    }
  }

  // Execute with result budgeting
  try {
    const result = await tool.call(parsed.data, context);
    // Cap large outputs
    if (result.output.length > MAX_TOOL_RESULT_CHARS) {
      return {
        output: result.output.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n... (truncated, ${result.output.length.toLocaleString()} chars total)`,
        isError: result.isError,
      };
    }
    return result;
  } catch (err) {
    return { output: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

// ── Helpers ──

type Batch = { concurrent: boolean; calls: ToolCall[] };

function partitionToolCalls(toolCalls: ToolCall[], tools: Tools): Batch[] {
  const batches: Batch[] = [];
  let currentConcurrent: ToolCall[] = [];

  for (const tc of toolCalls) {
    const tool = findToolByName(tools, tc.toolName);
    const isSafe = tool ? tool.isConcurrencySafe(tc.arguments) : false;
    if (isSafe) {
      currentConcurrent.push(tc);
    } else {
      if (currentConcurrent.length > 0) {
        batches.push({ concurrent: true, calls: currentConcurrent });
        currentConcurrent = [];
      }
      batches.push({ concurrent: false, calls: [tc] });
    }
  }
  if (currentConcurrent.length > 0) {
    batches.push({ concurrent: true, calls: currentConcurrent });
  }
  return batches;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => {
    let tokens = estimateTokens(m.content) + 10;
    // Include tool call arguments and results in estimate
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

const CONTEXT_WINDOWS: Record<string, number> = {
  "llama3": 8192, "qwen2.5:7b-instruct": 32768,
  "gpt-4o": 128000, "gpt-4o-mini": 128000, "o3-mini": 200000,
  "claude-sonnet-4-6": 200000, "claude-haiku-4-5": 200000, "claude-opus-4-6": 200000,
  "deepseek-chat": 64000, "deepseek-coder": 64000,
};

function getContextWindow(model?: string): number {
  if (!model) return 8192;
  return CONTEXT_WINDOWS[model] ?? 32768;
}

function compressMessages(messages: Message[], targetTokens: number): Message[] {
  if (messages.length <= 2) return messages;

  const result = [...messages];
  const keepLast = 10;

  // Phase 1: Truncate old tool results (keep last N)
  let toolResultCount = 0;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]!.role === "tool") toolResultCount++;
    if (result[i]!.role === "tool" && toolResultCount > keepLast) {
      result[i] = { ...result[i]!, content: "[previous tool result truncated]" };
    }
  }

  // Phase 2: If still over, drop oldest non-system messages
  while (estimateMessagesTokens(result) > targetTokens && result.length > keepLast + 1) {
    const firstNonSystem = result.findIndex((m) => m.role !== "system");
    if (firstNonSystem === -1 || firstNonSystem >= result.length - keepLast) break;
    result.splice(firstNonSystem, 1);
  }

  return result;
}

export type { QueryLoopState };
