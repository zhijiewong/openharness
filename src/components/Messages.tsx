import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types/message.js";
import type { ToolCallState } from "./ToolCallDisplay.js";
import ToolCallDisplay from "./ToolCallDisplay.js";

type MessagesProps = {
  messages: Message[];
  toolCalls: Map<string, ToolCallState>;
};

export default function Messages({ messages, toolCalls }: MessagesProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageRow key={msg.uuid} message={msg} toolCalls={toolCalls} />
      ))}
    </Box>
  );
}

function MessageRow({
  message,
  toolCalls,
}: {
  message: Message;
  toolCalls: Map<string, ToolCallState>;
}) {
  const { role, content } = message;

  if (role === "user") {
    return (
      <Box marginY={0}>
        <Text color="cyan" bold>{"❯ "}</Text>
        <Text bold>{content}</Text>
      </Box>
    );
  }

  if (role === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        {content ? (
          <Box>
            <Text color="magenta" bold>{"◆ "}</Text>
            <Text>{content}</Text>
          </Box>
        ) : null}
        {message.toolCalls?.map((tc) => {
          const state = toolCalls.get(tc.id);
          return state ? <ToolCallDisplay key={tc.id} toolCall={state} /> : null;
        })}
      </Box>
    );
  }

  if (role === "tool") {
    return null; // Tool results shown inline via ToolCallDisplay
  }

  return null;
}
