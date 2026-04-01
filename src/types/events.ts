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

export type StreamEvent =
  | TextDelta
  | ToolCallStart
  | ToolCallEnd
  | PermissionRequest
  | CostUpdate
  | TurnComplete
  | ErrorEvent;
