import React from "react";
import { Box, Text } from "ink";

type Props = {
  model?: string;
  permissionMode: string;
};

export default function StatusBar({ model, permissionMode }: Props) {
  return (
    <Box marginTop={0}>
      <Text dimColor>
        {"─".repeat(60)}
      </Text>
    </Box>
  );
}
