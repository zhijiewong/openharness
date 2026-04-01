import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

type SpinnerProps = {
  label?: string;
  model?: string;
};

export default function Spinner({ label, model }: SpinnerProps) {
  return (
    <Box>
      <Text color="magenta">
        <InkSpinner type="dots" />
      </Text>
      <Text dimColor>
        {" "}
        {label ?? "Thinking"}
        {model ? ` (${model})` : ""}
        ...
      </Text>
    </Box>
  );
}
