import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

export type ToolCallState = {
  callId: string;
  toolName: string;
  status: "running" | "done" | "error";
  output?: string;
  args?: string;
};

type Props = {
  toolCall: ToolCallState;
};

export default function ToolCallDisplay({ toolCall }: Props) {
  const { toolName, status, output, args } = toolCall;

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box>
        {status === "running" ? (
          <Text color="yellow"><InkSpinner type="dots" />{" "}</Text>
        ) : status === "error" ? (
          <Text color="red">{"✗ "}</Text>
        ) : (
          <Text color="green">{"✓ "}</Text>
        )}
        <Text color="yellow" bold>{toolName}</Text>
        {status === "running" && args && (
          <Text dimColor>{" "}{args.slice(0, 60)}{args.length > 60 ? "..." : ""}</Text>
        )}
      </Box>

      {output != null && status !== "running" && (
        <Box marginLeft={4}>
          <Text color={status === "error" ? "red" : "gray"} dimColor>
            {truncate(output, 3)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function truncate(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length} lines)`;
}
