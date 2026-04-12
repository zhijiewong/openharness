import { Box, Text } from "ink";
import React from "react";
import type { Message } from "../types/message.js";
import { useTheme } from "../utils/theme.js";
import Markdown from "./Markdown.js";
import type { ToolCallState } from "./ToolCallDisplay.js";
import ToolCallDisplay from "./ToolCallDisplay.js";

type MessagesProps = {
  messages: Message[];
  toolCalls: Map<string, ToolCallState>;
};

export default function Messages({ messages, toolCalls }: MessagesProps) {
  const theme = useTheme();

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        const showDivider = msg.role === "user" && i > 0;
        return (
          <React.Fragment key={msg.uuid}>
            {showDivider && <Text color={theme.dim}>{"─".repeat(60)}</Text>}
            <MessageRow message={msg} toolCalls={toolCalls} theme={theme} />
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function MessageRow({
  message,
  toolCalls,
  theme,
}: {
  message: Message;
  toolCalls: Map<string, ToolCallState>;
  theme: ReturnType<typeof import("../utils/theme.js").useTheme>;
}) {
  if (message.role === "user") {
    return (
      <Box marginY={0}>
        <Text color={theme.user} bold>
          {"❯ "}
        </Text>
        <Text bold>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === "assistant") {
    return (
      <Box flexDirection="column" marginY={0}>
        {message.content ? (
          <Box>
            <Text color={theme.assistant} bold>
              {"◆ "}
            </Text>
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

  // System messages: info (dimmed) vs error (red border)
  if (message.role === "system") {
    if (message.meta?.isInfo) {
      return (
        <Box marginY={0}>
          <Text dimColor>
            {"  "}
            {message.content}
          </Text>
        </Box>
      );
    }
    return (
      <Box borderStyle="round" borderColor={theme.error} paddingX={1} marginY={0}>
        <Text color={theme.error}>
          {"✗ "}
          {message.content}
        </Text>
      </Box>
    );
  }

  return null;
}
