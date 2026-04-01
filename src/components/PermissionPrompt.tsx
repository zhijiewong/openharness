import React from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../utils/theme.js";

type Props = {
  toolName: string;
  description: string;
  riskLevel: string;
  onResolve: (allowed: boolean) => void;
};

export default function PermissionPrompt({
  toolName,
  description,
  riskLevel,
  onResolve,
}: Props) {
  const theme = useTheme();

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onResolve(true);
    if (key === "n") onResolve(false);
  });

  const borderColor =
    riskLevel === "high"
      ? theme.error
      : riskLevel === "medium"
        ? theme.warning
        : theme.success;

  // Extract contextual info from description
  const suggestion = extractSuggestion(toolName, description);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      paddingY={0}
      marginY={1}
    >
      <Box>
        <Text color={borderColor} bold>
          {"⚠ "}
        </Text>
        <Text bold>{toolName}</Text>
        <Text color={theme.dim}> {riskLevel} risk</Text>
      </Box>

      {suggestion && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>{suggestion}</Text>
        </Box>
      )}

      <Box marginLeft={2} marginY={0}>
        <Text>{description.slice(0, 300)}</Text>
      </Box>

      <Box marginTop={0}>
        <Text>
          Allow? [<Text color={theme.success} bold>Y</Text>/
          <Text color={theme.error} bold>N</Text>]{" "}
        </Text>
      </Box>
    </Box>
  );
}

function extractSuggestion(toolName: string, description: string): string | null {
  const lower = toolName.toLowerCase();

  if (lower === "bash" || lower === "shell" || lower === "execute") {
    // Try to extract the command
    const cmdMatch = description.match(/command[:\s]+["`]?(.+?)["`]?(?:\n|$)/i);
    if (cmdMatch) return `$ ${cmdMatch[1]}`;
  }

  if (lower === "read" || lower === "write" || lower === "edit") {
    const pathMatch = description.match(/(?:path|file)[:\s]+["`]?([^\s"`]+)/i);
    if (pathMatch) return `${lower === "read" ? "reading" : lower === "write" ? "writing" : "editing"} ${pathMatch[1]}`;
  }

  return null;
}
