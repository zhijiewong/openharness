import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

type ToolCallState = {
  callId: string;
  toolName: string;
  status: "running" | "done" | "error";
  output?: string;
};

type ToolCallDisplayProps = {
  toolCall: ToolCallState;
};

const MAX_OUTPUT = 200;

export default function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const { toolName, status, output } = toolCall;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        {status === "running" ? (
          <Text color="cyan">
            <InkSpinner type="dots" />{" "}
          </Text>
        ) : status === "error" ? (
          <Text color="red">{"✗ "}</Text>
        ) : (
          <Text color="green">{"✓ "}</Text>
        )}
        <Text color="cyan" bold>
          {toolName}
        </Text>
        {status === "running" && <Text dimColor> running...</Text>}
      </Box>
      {output != null && (
        <Box marginLeft={2}>
          <Text color={status === "error" ? "red" : "gray"} wrap="truncate-end">
            {output.length > MAX_OUTPUT
              ? output.slice(0, MAX_OUTPUT) + "..."
              : output}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export type { ToolCallState };
