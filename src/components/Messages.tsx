import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types/message.js";
import type { ToolCallState } from "./ToolCallDisplay.js";
import ToolCallDisplay from "./ToolCallDisplay.js";
import Markdown from "./Markdown.js";

type MessagesProps = {
  messages: Message[];
  toolCalls: Map<string, ToolCallState>;
};

export default function Messages({ messages, toolCalls }: MessagesProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        const showDivider = msg.role === "user" && i > 0;
        return (
          <React.Fragment key={msg.uuid}>
            {showDivider && <Text dimColor>{"─".repeat(50)}</Text>}
            <MessageRow message={msg} toolCalls={toolCalls} />
          </React.Fragment>
        );
      })}
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
  if (message.role === "user") {
    return (
      <Box marginY={0}>
        <Text color="cyan" bold>{"❯ "}</Text>
        <Text bold>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        {message.content ? (
          <Box>
            <Text color="magenta" bold>{"◆ "}</Text>
            <Box flexDirection="column" flexGrow={1}>
              <Markdown>{message.content}</Markdown>
            </Box>
          </Box>
        ) : null}
        {message.toolCalls?.map((tc) => {
          const state = toolCalls.get(tc.id);
          return state ? <ToolCallDisplay key={tc.id} toolCall={state} /> : null;
        })}
      </Box>
    );
  }

  return null;
}
