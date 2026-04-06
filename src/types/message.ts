/**
 * Core message types for the agent conversation loop.
 */

export type Role = "user" | "assistant" | "system" | "tool";

export type ToolCall = {
  readonly id: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
};

export type ToolResult = {
  readonly callId: string;
  readonly output: string;
  readonly isError: boolean;
};

export type Message = {
  readonly role: Role;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolResults?: readonly ToolResult[];
  readonly uuid: string;
  readonly timestamp: number;
  /** Optional display hints — not sent to LLM */
  readonly meta?: { isInfo?: boolean; pinned?: boolean; isStreaming?: boolean };
};

export function createMessage(
  role: Role,
  content: string,
  extra?: Partial<Pick<Message, "toolCalls" | "toolResults" | "meta">>,
): Message {
  return {
    role,
    content,
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    ...extra,
  };
}

export function createInfoMessage(content: string): Message {
  return createMessage("system", content, { meta: { isInfo: true } });
}

export function createPinnedMessage(content: string): Message {
  return createMessage("system", content, { meta: { isInfo: true, pinned: true } });
}

export function createUserMessage(content: string): Message {
  return createMessage("user", content);
}

export function createAssistantMessage(
  content: string,
  toolCalls?: readonly ToolCall[],
): Message {
  return createMessage("assistant", content, { toolCalls });
}

export function createToolResultMessage(result: ToolResult): Message {
  return createMessage("tool", result.output, { toolResults: [result] });
}
