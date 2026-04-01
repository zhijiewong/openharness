import React from "react";
import { Box, Text, useInput } from "ink";

type PermissionPromptProps = {
  toolName: string;
  description: string;
  riskLevel: string;
  onResolve: (allowed: boolean) => void;
};

const riskColor: Record<string, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
};

export default function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onResolve,
}: PermissionPromptProps) {
  useInput((input) => {
    if (input.toLowerCase() === "y") onResolve(true);
    if (input.toLowerCase() === "n") onResolve(false);
  });

  const color = riskColor[riskLevel] ?? "white";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Text bold color={color}>
        Permission Request [{riskLevel.toUpperCase()}]
      </Text>
      <Text>
        Tool: <Text bold>{toolName}</Text>
      </Text>
      <Text dimColor>{description}</Text>
      <Box marginTop={1}>
        <Text>
          Allow? [<Text color="green" bold>Y</Text>/<Text color="red" bold>N</Text>]
        </Text>
      </Box>
    </Box>
  );
}
