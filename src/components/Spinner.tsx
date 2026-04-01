import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

type SpinnerProps = {
  model?: string;
};

export default function Spinner({ model }: SpinnerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="magenta">
        <InkSpinner type="dots" />
      </Text>
      <Text dimColor>
        {" "}Thinking{model ? ` (${model})` : ""}
        {elapsed > 0 ? ` ${elapsed}s` : ""}...
      </Text>
    </Box>
  );
}
