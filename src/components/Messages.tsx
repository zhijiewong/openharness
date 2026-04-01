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
        <Text color="green" bold>
          You:{" "}
        </Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  if (role === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color="blue" bold>
            Assistant:{" "}
          </Text>
          <Text>{content}</Text>
        </Box>
        {message.toolCalls?.map((tc) => {
          const state = toolCalls.get(tc.id);
          return state ? (
            <ToolCallDisplay key={tc.id} toolCall={state} />
          ) : null;
        })}
      </Box>
    );
  }

  if (role === "tool") {
    const result = message.toolResults?.[0];
    return (
      <Box marginLeft={4} marginY={0}>
        <Text dimColor>
          {result?.isError ? "[error] " : "[result] "}
          {content.length > 150 ? content.slice(0, 150) + "..." : content}
        </Text>
      </Box>
    );
  }

  return null;
}
