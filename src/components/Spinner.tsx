import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../utils/theme.js";
import { formatTokenCount } from "../utils/format.js";

type Props = { model?: string; tokens?: number };

export default function Spinner({ model, tokens }: Props) {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setFrame((f) => f + 1);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const text = `Thinking${model ? ` (${model})` : ""}`;
  const baseColor =
    elapsed > 60 ? theme.error : elapsed > 30 ? theme.stall : theme.primary;
  const shimmerColor =
    elapsed > 60 ? theme.stallShimmer : elapsed > 30 ? theme.warning : theme.primaryShimmer;
  const shimmerPos = frame % (text.length + 6);

  return (
    <Box>
      <Text color={baseColor}>{"◆ "}</Text>
      {text.split("").map((char, i) => {
        const dist = Math.abs(i - shimmerPos);
        const bright = dist <= 1;
        return (
          <Text key={i} color={bright ? shimmerColor : baseColor} bold={bright}>
            {char}
          </Text>
        );
      })}
      <Text color={theme.dim}>
        {elapsed > 0 ? ` ${elapsed}s` : ""}
        {tokens && tokens > 0 ? ` | ${`${formatTokenCount(tokens)} tokens`}` : ""}
        ...
      </Text>
    </Box>
  );
}

// Uses shared formatTokenCount from utils/format.ts
