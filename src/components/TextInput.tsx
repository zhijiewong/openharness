import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import InkTextInput from "ink-text-input";
import { useTheme } from "../utils/theme.js";
import { getCommandNames } from "../commands/index.js";

type TextInputProps = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  vimMode?: boolean;
};

type VimState = 'insert' | 'normal';

export default function TextInput({ onSubmit, disabled, vimMode = false }: TextInputProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [vim, setVim] = useState<VimState>(vimMode ? 'normal' : 'insert');
  const [autocomplete, setAutocomplete] = useState<string[]>([]);
  const [acIndex, setAcIndex] = useState(-1);

  // Autocomplete for slash commands
  const updateAutocomplete = useCallback((val: string) => {
    if (val.startsWith('/') && val.length > 1 && !val.includes(' ')) {
      const prefix = val.slice(1).toLowerCase();
      const matches = getCommandNames().filter(n => n.startsWith(prefix)).slice(0, 5);
      setAutocomplete(matches);
      setAcIndex(-1);
    } else {
      setAutocomplete([]);
      setAcIndex(-1);
    }
  }, []);

  useInput(
    (input, key) => {
      // Vim mode handling
      if (vimMode && vim === 'normal') {
        if (input === 'i') { setVim('insert'); return; }
        if (input === 'a') { setVim('insert'); return; }
        if (input === 'A') { setVim('insert'); return; }
        if (input === '0') { return; } // cursor to start — not easily doable with InkTextInput
        if (input === '$') { return; } // cursor to end
        if (input === 'x') { setValue(v => v.slice(0, -1)); return; }
        if (input === 'D' || input === 'C') { setValue(''); if (input === 'C') setVim('insert'); return; }
        if (input === 'u') { setValue(''); return; } // undo = clear
        // History navigation in normal mode
        if (key.upArrow || input === 'k') {
          if (history.length > 0) {
            const next = Math.min(historyIndex + 1, history.length - 1);
            setHistoryIndex(next);
            setValue(history[next]!);
          }
          return;
        }
        if (key.downArrow || input === 'j') {
          if (historyIndex <= 0) {
            setHistoryIndex(-1);
            setValue("");
          } else {
            const next = historyIndex - 1;
            setHistoryIndex(next);
            setValue(history[next]!);
          }
          return;
        }
        return; // Swallow other keys in normal mode
      }

      // Escape → normal mode (vim) or clear autocomplete
      if (key.escape) {
        if (vimMode) { setVim('normal'); return; }
        setAutocomplete([]); setAcIndex(-1);
        return;
      }

      // Tab for autocomplete
      if (key.tab && autocomplete.length > 0) {
        const nextIdx = (acIndex + 1) % autocomplete.length;
        setAcIndex(nextIdx);
        setValue(`/${autocomplete[nextIdx]!} `);
        setAutocomplete([]);
        return;
      }

      // History navigation
      if (key.upArrow && history.length > 0) {
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next]!);
        return;
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
        return;
      }
    },
    { isActive: !disabled },
  );

  const handleChange = useCallback((val: string) => {
    setValue(val);
    updateAutocomplete(val);
  }, [updateAutocomplete]);

  const handleSubmit = useCallback(
    (submitted: string) => {
      if (!submitted.trim() || disabled) return;
      setHistory((prev) => [submitted, ...prev]);
      setHistoryIndex(-1);
      setValue("");
      setAutocomplete([]);
      setAcIndex(-1);
      if (vimMode) setVim('normal');
      onSubmit(submitted);
    },
    [onSubmit, disabled, vimMode],
  );

  const placeholder = disabled ? "Waiting..." : vimMode && vim === 'normal' ? "-- NORMAL -- (i to insert)" : "Ask anything...";
  const modeIndicator = vimMode ? (vim === 'normal' ? '[N]' : '[I]') : null;

  return (
    <Box flexDirection="column">
      {/* Autocomplete suggestions */}
      {autocomplete.length > 0 && (
        <Box flexDirection="row" gap={1}>
          {autocomplete.map((cmd, i) => (
            <Text key={cmd} color={i === acIndex ? 'cyan' : undefined} dimColor={i !== acIndex}>
              /{cmd}
            </Text>
          ))}
        </Box>
      )}
      <Box
        borderStyle="single"
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.border}
        paddingX={0}
      >
        {modeIndicator && (
          <Text color={vim === 'normal' ? 'blue' : 'green'} bold>{modeIndicator} </Text>
        )}
        <Text color={theme.user} bold>
          {"❯ "}
        </Text>
        <InkTextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}
