/**
 * Tool execution — permission checking, batching, output capping.
 */

import { createCheckpoint, getAffectedFiles } from "../harness/checkpoints.js";
import { emitHook } from "../harness/hooks.js";
import type { ToolContext, ToolResult, Tools } from "../Tool.js";
import { findToolByName } from "../Tool.js";
import type { StreamEvent } from "../types/events.js";
import type { ToolCall } from "../types/message.js";
import { createToolResultMessage } from "../types/message.js";
import type { AskUserFn, PermissionMode } from "../types/permissions.js";
import { checkPermission } from "../types/permissions.js";
import type { QueryLoopState } from "./types.js";

const MAX_TOOL_RESULT_CHARS = 100_000;
const TOOL_TIMEOUT_MS = 120_000;

type Batch = { concurrent: boolean; calls: ToolCall[] };

export function partitionToolCalls(toolCalls: ToolCall[], tools: Tools): Batch[] {
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

export async function executeSingleTool(
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

  // Permission check
  const perm = checkPermission(permissionMode, tool.riskLevel, tool.isReadOnly(parsed.data), tool.name, parsed.data);
  if (!perm.allowed) {
    if (perm.reason === "needs-approval" && askUser) {
      const { formatToolArgs } = await import("../utils/tool-summary.js");
      const description = formatToolArgs(tool.name, toolCall.arguments as Record<string, unknown>);
      const allowed = await askUser(tool.name, description, tool.riskLevel);
      if (!allowed) {
        return { output: "Permission denied by user.", isError: true };
      }
    } else {
      return { output: `Permission denied: ${perm.reason}`, isError: true };
    }
  }

  // Checkpoint: save affected files before modification
  if (!tool.isReadOnly(parsed.data)) {
    const affected = getAffectedFiles(tool.name, parsed.data as Record<string, unknown>);
    if (affected.length > 0) {
      createCheckpoint(0, affected, `${tool.name} ${affected[0]}`);
    }
  }

  // Hook: preToolUse
  const hookAllowed = emitHook("preToolUse", {
    toolName: tool.name,
    toolArgs: JSON.stringify(toolCall.arguments).slice(0, 1000),
  });
  if (!hookAllowed) {
    return { output: "Blocked by preToolUse hook.", isError: true };
  }

  // Execute with timeout and result budgeting
  try {
    const toolAbort = AbortSignal.timeout(TOOL_TIMEOUT_MS);
    const contextWithTimeout = { ...context, abortSignal: context.abortSignal ?? toolAbort };
    let result = await Promise.race([
      tool.call(parsed.data, contextWithTimeout),
      new Promise<never>((_, reject) => {
        toolAbort.addEventListener("abort", () =>
          reject(new Error(`Tool '${tool.name}' timed out after ${TOOL_TIMEOUT_MS / 1000}s`)),
        );
      }),
    ]);

    // Hook: postToolUse
    emitHook("postToolUse", {
      toolName: tool.name,
      toolArgs: JSON.stringify(toolCall.arguments).slice(0, 1000),
      toolOutput: result.output.slice(0, 1000),
    });

    // Emit fileChanged hook for file-modifying tools
    if (!result.isError && ["Edit", "Write", "MultiEdit"].includes(tool.name)) {
      const filePaths = getAffectedFiles(tool.name, parsed.data as Record<string, unknown>);
      for (const fp of filePaths) {
        emitHook("fileChanged", { filePath: fp, toolName: tool.name });
      }
    }

    // Verification loop: auto-run lint/typecheck after file-modifying tools
    let verificationSuffix = "";
    if (!result.isError && ["Edit", "Write", "MultiEdit"].includes(tool.name)) {
      try {
        const { runVerificationForFiles, getVerificationConfig, extractFilePaths } = await import(
          "../harness/verification.js"
        );
        const vConfig = getVerificationConfig();
        if (vConfig?.enabled) {
          const filePaths = extractFilePaths(tool.name, parsed.data as Record<string, unknown>);
          if (filePaths.length > 0) {
            const vResult = await runVerificationForFiles(filePaths, vConfig);
            if (vResult.ran) {
              if (!vResult.passed) {
                verificationSuffix = `\n\n[Verification FAILED]\n${vResult.summary}`;
                if (vConfig.mode === "block") {
                  result = { output: result.output, isError: true };
                }
              } else {
                verificationSuffix = "\n\n[Verification passed]";
              }
            }
          }
        }
      } catch {
        /* verification should never break tool execution */
      }
    }

    // Auto-commit per tool (if enabled and file was modified)
    if (!result.isError && context.gitCommitPerTool && !tool.isReadOnly(parsed.data)) {
      try {
        const { autoCommitAIEdits } = await import("../git/index.js");
        const filePaths = getAffectedFiles(tool.name, parsed.data as Record<string, unknown>);
        autoCommitAIEdits(tool.name, filePaths);
      } catch {
        /* auto-commit is optional */
      }
    }

    // Strip ANSI and cap output, then append verification suffix
    let output = result.output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") + verificationSuffix;
    if (output.length > MAX_TOOL_RESULT_CHARS) {
      output =
        output.slice(0, MAX_TOOL_RESULT_CHARS) +
        `\n\n[TRUNCATED: output was ${output.length.toLocaleString()} chars, showing first ${MAX_TOOL_RESULT_CHARS.toLocaleString()}]`;
    }
    return { output, isError: result.isError };
  } catch (err) {
    return { output: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

export async function* executeToolCalls(
  toolCalls: ToolCall[],
  tools: Tools,
  context: ToolContext,
  permissionMode: PermissionMode,
  askUser?: AskUserFn,
  state?: QueryLoopState,
): AsyncGenerator<StreamEvent, void> {
  const batches = partitionToolCalls(toolCalls, tools);
  const outputChunks: StreamEvent[] = [];
  const onOutputChunk = (callId: string, chunk: string) => {
    outputChunks.push({ type: "tool_output_delta", callId, chunk });
  };

  for (const batch of batches) {
    if (batch.concurrent) {
      const results = await Promise.all(
        batch.calls.map((tc) =>
          executeSingleTool(tc, tools, { ...context, callId: tc.id, onOutputChunk }, permissionMode, askUser),
        ),
      );
      for (const chunk of outputChunks.splice(0)) yield chunk;
      for (let i = 0; i < batch.calls.length; i++) {
        const tc = batch.calls[i]!;
        const result = results[i]!;
        yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
        state?.messages.push(
          createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }),
        );
      }
    } else {
      for (const tc of batch.calls) {
        const result = await executeSingleTool(
          tc,
          tools,
          { ...context, callId: tc.id, onOutputChunk },
          permissionMode,
          askUser,
        );
        for (const chunk of outputChunks.splice(0)) yield chunk;
        yield { type: "tool_call_end", callId: tc.id, output: result.output, isError: result.isError };
        state?.messages.push(
          createToolResultMessage({ callId: tc.id, output: result.output, isError: result.isError }),
        );
      }
    }
  }
}
