import React from "react";
import { Box, Text, useInput } from "ink";

type Props = {
  toolName: string;
  description: string;
  riskLevel: string;
  onResolve: (allowed: boolean) => void;
};

const RISK_COLORS: Record<string, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
};

export default function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onResolve,
}: Props) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onResolve(true);
    if (key === "n") onResolve(false);
  });

  const color = RISK_COLORS[riskLevel] ?? "white";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={2}
      paddingY={0}
      marginY={1}
    >
      <Box>
        <Text color={color} bold>
          {"⚠ "}
        </Text>
        <Text bold>{toolName}</Text>
        <Text dimColor>{" "}{riskLevel} risk</Text>
      </Box>

      <Box marginLeft={2} marginY={0}>
        <Text>{description.slice(0, 300)}</Text>
      </Box>

      <Box marginTop={0}>
        <Text>
          Allow? [<Text color="green" bold>Y</Text>/<Text color="red" bold>N</Text>]{" "}
        </Text>
      </Box>
    </Box>
  );
}
