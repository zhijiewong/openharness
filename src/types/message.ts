/**
 * Core message types — mirrors Claude Code's types/message.ts pattern.
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
};

export function createMessage(
  role: Role,
  content: string,
  extra?: Partial<Pick<Message, "toolCalls" | "toolResults">>,
): Message {
  return {
    role,
    content,
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    ...extra,
  };
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
