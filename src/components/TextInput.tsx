import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import InkTextInput from "ink-text-input";

type TextInputProps = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
};

export default function TextInput({ onSubmit, disabled }: TextInputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((_input, key) => {
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
  }, { isActive: !disabled });

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

  return (
    <Box>
      <Text color="cyan" bold>
        {"❯ "}
      </Text>
      <InkTextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={disabled ? "Waiting..." : "Type a message..."}
      />
    </Box>
  );
}
