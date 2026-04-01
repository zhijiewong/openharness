import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import InkTextInput from "ink-text-input";
import { useTheme } from "../utils/theme.js";

type TextInputProps = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
};

export default function TextInput({ onSubmit, disabled }: TextInputProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput(
    (_input, key) => {
      if (key.upArrow && history.length > 0) {
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next]!);
      }
      if (key.downArrow) {
        if (historyIndex <= 0) {
          setHistoryIndex(-1);
          setValue("");
        } else {
          const next = historyIndex - 1;
          setHistoryIndex(next);
          setValue(history[next]!);
        }
      }
    },
    { isActive: !disabled },
  );

  const handleSubmit = useCallback(
    (submitted: string) => {
      if (!submitted.trim() || disabled) return;
      setHistory((prev) => [submitted, ...prev]);
      setHistoryIndex(-1);
      setValue("");
      onSubmit(submitted);
    },
    [onSubmit, disabled],
  );

  const placeholder = disabled ? "Waiting..." : "Ask anything...";

  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.border}
      paddingX={0}
    >
      <Text color={theme.user} bold>
        {"❯ "}
      </Text>
      <InkTextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
}
