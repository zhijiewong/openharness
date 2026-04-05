/**
 * Streaming event types for the agent loop.
 */

export type TextDelta = {
  readonly type: "text_delta";
  readonly content: string;
};

export type ToolCallStart = {
  readonly type: "tool_call_start";
  readonly toolName: string;
  readonly callId: string;
};

export type ToolCallComplete = {
  readonly type: "tool_call_complete";
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
};

export type ToolCallEnd = {
  readonly type: "tool_call_end";
  readonly callId: string;
  readonly output: string;
  readonly isError: boolean;
};

export type PermissionRequest = {
  readonly type: "permission_request";
  readonly toolName: string;
  readonly callId: string;
  readonly description: string;
  readonly riskLevel: string;
};

export type CostUpdate = {
  readonly type: "cost_update";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly model: string;
};

export type TurnComplete = {
  readonly type: "turn_complete";
  readonly reason: string;
  readonly sessionId?: string;
};

export type ErrorEvent = {
  readonly type: "error";
  readonly message: string;
};

export type RateLimited = {
  readonly type: "rate_limited";
  readonly retryIn: number;   // seconds
  readonly attempt: number;   // 1-based
};

export type ThinkingDelta = {
  readonly type: "thinking_delta";
  readonly content: string;
};

export type ToolOutputDelta = {
  readonly type: "tool_output_delta";
  readonly callId: string;
  readonly chunk: string;
};

export type AskUserRequest = {
  readonly type: "ask_user";
  readonly callId: string;
  readonly question: string;
  readonly options?: readonly string[];
};

export type StreamEvent =
  | TextDelta
  | ToolCallStart
  | ToolCallComplete
  | ToolCallEnd
  | ToolOutputDelta
  | PermissionRequest
  | AskUserRequest
  | CostUpdate
  | TurnComplete
  | ErrorEvent
  | RateLimited
  | ThinkingDelta;
