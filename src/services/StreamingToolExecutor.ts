/**
 * Tool execution during LLM streaming — concurrent tool execution
 * with permission checks and queue management.
 */

import type { ToolCall } from "../types/message.js";
import type { Tool, ToolResult, ToolContext, Tools } from "../Tool.js";
import { findToolByName } from "../Tool.js";
import type { PermissionMode, AskUserFn } from "../types/permissions.js";
import { checkPermission } from "../types/permissions.js";

type ToolStatus = "queued" | "executing" | "completed" | "yielded";

type TrackedTool = {
  id: string;
  toolCall: ToolCall;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  result?: ToolResult;
  promise?: Promise<void>;
};

const MAX_CONCURRENCY = 10;

export class StreamingToolExecutor {
  private tracked: TrackedTool[] = [];

  constructor(
    private tools: Tools,
    private context: ToolContext,
    private permissionMode: PermissionMode,
    private askUser?: AskUserFn,
  ) {}

  addTool(toolCall: ToolCall): void {
    const tool = findToolByName(this.tools, toolCall.toolName);
    const isSafe = tool ? tool.isConcurrencySafe(toolCall.arguments) : false;
    this.tracked.push({
      id: toolCall.id,
      toolCall,
      status: "queued",
      isConcurrencySafe: isSafe,
    });
    this.processQueue();
  }

  private processQueue(): void {
    const executing = this.tracked.filter((t) => t.status === "executing");

    for (const tool of this.tracked) {
      if (tool.status !== "queued") continue;
      if (executing.length >= MAX_CONCURRENCY) break;
      if (executing.length > 0 && !tool.isConcurrencySafe) break;
      if (executing.length > 0 && executing.some((e) => !e.isConcurrencySafe)) break;

      tool.status = "executing";
      tool.promise = this.executeTool(tool);
      executing.push(tool);
    }
  }

  private async executeTool(tracked: TrackedTool): Promise<void> {
    const tool = findToolByName(this.tools, tracked.toolCall.toolName);
    if (!tool) {
      tracked.result = { output: `Unknown tool: ${tracked.toolCall.toolName}`, isError: true };
      tracked.status = "completed";
      return;
    }

    // Permission check
    const perm = checkPermission(
      this.permissionMode,
      tool.riskLevel,
      tool.isReadOnly(tracked.toolCall.arguments),
    );

    if (!perm.allowed && perm.reason === "needs-approval" && this.askUser) {
      const allowed = await this.askUser(
        tool.name,
        JSON.stringify(tracked.toolCall.arguments).slice(0, 200),
      );
      if (!allowed) {
        tracked.result = { output: "Permission denied.", isError: true };
        tracked.status = "completed";
        return;
      }
    } else if (!perm.allowed) {
      tracked.result = { output: `Denied: ${perm.reason}`, isError: true };
      tracked.status = "completed";
      return;
    }

    // Validate input
    const parsed = tool.inputSchema.safeParse(tracked.toolCall.arguments);
    if (!parsed.success) {
      tracked.result = { output: `Validation: ${parsed.error.message}`, isError: true };
      tracked.status = "completed";
      return;
    }

    // Execute
    try {
      tracked.result = await tool.call(parsed.data, this.context);
    } catch (err) {
      tracked.result = {
        output: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    tracked.status = "completed";
    this.processQueue(); // Process next queued tools
  }

  *getCompletedResults(): Generator<{ toolCall: ToolCall; result: ToolResult }> {
    for (const t of this.tracked) {
      if (t.status === "completed" && t.result) {
        t.status = "yielded";
        yield { toolCall: t.toolCall, result: t.result };
      } else if (t.status === "executing" && !t.isConcurrencySafe) {
        break; // Don't skip past non-concurrent executing tools
      }
    }
  }

  async waitForAll(): Promise<void> {
    await Promise.all(this.tracked.filter((t) => t.promise).map((t) => t.promise));
  }

  get pendingCount(): number {
    return this.tracked.filter((t) => t.status === "queued" || t.status === "executing").length;
  }
}
