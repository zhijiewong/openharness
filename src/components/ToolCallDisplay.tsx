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

const MAX_OUTPUT_LINES = 8;

export default function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const { toolName, status, output } = toolCall;

  const icon = status === "running" ? (
    <Text color="yellow"><InkSpinner type="dots" />{" "}</Text>
  ) : status === "error" ? (
    <Text color="red">{"✗ "}</Text>
  ) : (
    <Text color="green">{"✓ "}</Text>
  );

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box>
        {icon}
        <Text color="yellow" bold>{toolName}</Text>
        {status === "running" && <Text dimColor>{" ..."}</Text>}
      </Box>
      {output != null && status !== "running" && (
        <Box marginLeft={4}>
          <Text color={status === "error" ? "red" : "gray"} dimColor>
            {truncateOutput(output, MAX_OUTPUT_LINES)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function truncateOutput(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length} lines)`;
}

export type { ToolCallState };
