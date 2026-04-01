/**
 * Agent loop — the core LLM-to-Tool orchestration cycle.
 *
 * Mirrors Claude Code's query.ts while(true) pattern:
 * 1. Send messages to LLM
 * 2. If LLM requests tool calls → execute them → loop back
 * 3. If LLM returns text only → yield to UI → done
 *
 * Uses async generators for streaming events to the React UI.
 */

import type { Tool, ToolContext, ToolResult, Tools } from "./Tool.js";
import { findToolByName, toolToAPIFormat } from "./Tool.js";
import type { StreamEvent } from "./types/events.js";
import type {
  Message,
  ToolCall,
  ToolResult as MsgToolResult,
} from "./types/message.js";
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "./types/message.js";
import type { AskUserFn, PermissionMode } from "./types/permissions.js";
import { checkPermission } from "./types/permissions.js";
import type { Provider } from "./providers/base.js";

export type QueryConfig = {
  provider: Provider;
  tools: Tools;
  systemPrompt: string;
  permissionMode: PermissionMode;
  askUser?: AskUserFn;
  maxTurns?: number;
  maxCost?: number;
};

type State = {
  messages: Message[];
  turn: number;
  totalCost: number;
};

const DEFAULT_MAX_TURNS = 50;

/**
 * Main agent loop. Yields streaming events to the UI.
 */
export async function* query(
  userMessage: string,
  config: QueryConfig,
  existingMessages: Message[] = [],
): AsyncGenerator<StreamEvent, void> {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolContext: ToolContext = { workingDir: process.cwd() };

  const state: State = {
    messages: [
      ...existingMessages,
      createUserMessage(userMessage),
    ],
    turn: 0,
    totalCost: 0,
  };

  // Build system prompt with tool descriptions
  const toolPrompts = config.tools.map((t) => t.prompt()).join("\n\n");
  const fullSystemPrompt = config.systemPrompt + "\n\n# Available Tools\n\n" + toolPrompts;

  // API tool definitions
  const apiTools = config.tools.map(toolToAPIFormat);

  while (state.turn < maxTurns) {
    state.turn++;

    // Budget check
    if (config.maxCost && state.totalCost >= config.maxCost) {
      yield { type: "error", message: `Budget exceeded: $${state.totalCost.toFixed(4)}` };
      yield { type: "turn_complete", reason: "budget_exceeded" };
      return;
    }

    // Call LLM with streaming
    let assistantContent = "";
    const toolCalls: ToolCall[] = [];

    for await (const event of config.provider.stream(
      state.messages,
      fullSystemPrompt,
      apiTools,
    )) {
      if (event.type === "text_delta") {
        assistantContent += event.content;
        yield event;
      } else if (event.type === "tool_call_start") {
        // Placeholder — arguments populated by tool_call_complete
        toolCalls.push({
          id: event.callId,
          toolName: event.toolName,
          arguments: {},
        });
        yield event;
      } else if (event.type === "tool_call_complete") {
        // Update the matching tool call with final parsed arguments
        const tc = toolCalls.find((t) => t.id === event.callId);
        if (tc) {
          // ToolCall is readonly, so replace in-place
          const idx = toolCalls.indexOf(tc);
          toolCalls[idx] = { ...tc, arguments: event.arguments };
        }
      } else if (event.type === "cost_update") {
        state.totalCost += event.cost;
        yield event;
      }
    }

    // Add assistant message to history
    state.messages.push(
      createAssistantMessage(
        assistantContent,
        toolCalls.length > 0 ? toolCalls : undefined,
      ),
    );

    // No tool calls → done
    if (toolCalls.length === 0) {
      yield { type: "turn_complete", reason: "completed" };
      return;
    }

    // Execute tool calls with concurrency control
    yield* executeToolCalls(
      toolCalls,
      config.tools,
      toolContext,
      config.permissionMode,
      config.askUser,
      state,
    );
  }

  yield { type: "turn_complete", reason: "max_turns" };
}

/**
 * Execute tool calls, yielding events in real time.
 * Read-only tools run in parallel; write tools run serially.
 */
async function* executeToolCalls(
  toolCalls: ToolCall[],
  tools: Tools,
  context: ToolContext,
  permissionMode: PermissionMode,
  askUser?: AskUserFn,
  state?: State,
): AsyncGenerator<StreamEvent, void> {
  // Partition into batches
  const batches = partitionToolCalls(toolCalls, tools);

  for (const batch of batches) {
    if (batch.concurrent) {
      // Yield all starts
      for (const tc of batch.calls) {
        yield { type: "tool_call_start", toolName: tc.toolName, callId: tc.id };
      }

      // Run in parallel
      const results = await Promise.all(
        batch.calls.map((tc) =>
          executeSingleTool(tc, tools, context, permissionMode, askUser),
        ),
      );

      // Yield all ends + add to messages
      for (let i = 0; i < batch.calls.length; i++) {
        const tc = batch.calls[i]!;
        const result = results[i]!;
        yield {
          type: "tool_call_end",
          callId: tc.id,
          output: result.output,
          isError: result.isError,
        };
        state?.messages.push(
          createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }),
        );
      }
    } else {
      // Serial execution
      for (const tc of batch.calls) {
        yield { type: "tool_call_start", toolName: tc.toolName, callId: tc.id };

        const result = await executeSingleTool(
          tc,
          tools,
          context,
          permissionMode,
          askUser,
        );

        yield {
          type: "tool_call_end",
          callId: tc.id,
          output: result.output,
          isError: result.isError,
        };
        state?.messages.push(
          createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }),
        );
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

  // Parse input
  const parsed = tool.inputSchema.safeParse(toolCall.arguments);
  if (!parsed.success) {
    return { output: `Validation error: ${parsed.error.message}`, isError: true };
  }

  // Check permissions
  const perm = checkPermission(
    permissionMode,
    tool.riskLevel,
    tool.isReadOnly(parsed.data),
  );

  if (!perm.allowed && perm.reason === "needs-approval") {
    if (askUser) {
      const allowed = await askUser(tool.name, JSON.stringify(toolCall.arguments).slice(0, 200));
      if (!allowed) {
        return { output: "Permission denied by user.", isError: true };
      }
    } else {
      return { output: `Permission denied: ${perm.reason}`, isError: true };
    }
  } else if (!perm.allowed) {
    return { output: `Permission denied: ${perm.reason}`, isError: true };
  }

  // Execute
  try {
    return await tool.call(parsed.data, context);
  } catch (err) {
    return { output: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

type Batch = {
  concurrent: boolean;
  calls: ToolCall[];
};

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

export { type State };
