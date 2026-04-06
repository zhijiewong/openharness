/**
 * Keybinding customization — load user-defined keybindings from ~/.oh/keybindings.json.
 *
 * Format:
 * [
 *   { "key": "ctrl+s", "action": "/commit" },
 *   { "key": "ctrl+k ctrl+d", "action": "/diff" },
 *   { "key": "ctrl+p", "action": "/compact" }
 * ]
 *
 * Supports single keys and two-key chord sequences (e.g., "ctrl+k ctrl+d").
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type Keybinding = {
  key: string;       // e.g., "ctrl+s", "ctrl+k ctrl+d"
  action: string;    // slash command or custom action
};

type ParsedKey = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;       // the actual key character
};

const KEYBINDINGS_PATH = join(homedir(), '.oh', 'keybindings.json');

let cachedBindings: Keybinding[] | null = null;

/** Load keybindings from ~/.oh/keybindings.json */
export function loadKeybindings(): Keybinding[] {
  if (cachedBindings !== null) return cachedBindings;

  if (!existsSync(KEYBINDINGS_PATH)) {
    cachedBindings = defaultKeybindings();
    return cachedBindings;
  }

  try {
    const raw = readFileSync(KEYBINDINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cachedBindings = parsed as Keybinding[];
      return cachedBindings;
    }
  } catch { /* ignore parse errors */ }

  cachedBindings = defaultKeybindings();
  return cachedBindings;
}

/** Default keybindings */
function defaultKeybindings(): Keybinding[] {
  return [
    { key: 'ctrl+d', action: '/diff' },
    { key: 'ctrl+l', action: '/clear' },
    { key: 'ctrl+u', action: '/undo' },
  ];
}

/** Parse a key string like "ctrl+s" into components */
function parseKeyString(keyStr: string): ParsedKey {
  const parts = keyStr.toLowerCase().split('+');
  return {
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    key: parts.filter(p => p !== 'ctrl' && p !== 'alt' && p !== 'shift')[0] ?? '',
  };
}

/** Check if an Ink key event matches a parsed key */
function keyMatches(
  parsed: ParsedKey,
  input: string,
  inkKey: { ctrl: boolean; meta: boolean; shift: boolean },
): boolean {
  if (parsed.ctrl !== inkKey.ctrl) return false;
  if (parsed.alt !== inkKey.meta) return false;
  if (parsed.shift !== inkKey.shift) return false;
  return input.toLowerCase() === parsed.key;
}

/**
 * Keybinding matcher — handles single keys and chord sequences.
 *
 * Usage:
 *   const matcher = createKeybindingMatcher();
 *   // In useInput callback:
 *   const action = matcher.match(input, key);
 *   if (action) handleAction(action);
 */
export function createKeybindingMatcher() {
  const bindings = loadKeybindings();
  let pendingChord: ParsedKey | null = null;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  return {
    match(
      input: string,
      inkKey: { ctrl: boolean; meta: boolean; shift: boolean },
    ): string | null {
      // Parse all bindings
      for (const binding of bindings) {
        const parts = binding.key.split(/\s+/);

        if (parts.length === 1) {
          // Single key binding
          const parsed = parseKeyString(parts[0]!);
          if (keyMatches(parsed, input, inkKey)) {
            pendingChord = null;
            return binding.action;
          }
        } else if (parts.length === 2) {
          // Chord sequence
          const first = parseKeyString(parts[0]!);
          const second = parseKeyString(parts[1]!);

          if (pendingChord && keyMatches(second, input, inkKey)) {
            // Second key of chord matches
            pendingChord = null;
            if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
            return binding.action;
          }

          if (keyMatches(first, input, inkKey)) {
            // First key of chord matches — wait for second
            pendingChord = first;
            if (pendingTimeout) clearTimeout(pendingTimeout);
            pendingTimeout = setTimeout(() => {
              pendingChord = null;
              pendingTimeout = null;
            }, 1000); // 1s chord timeout
            return null; // consumed but no action yet
          }
        }
      }

      // No match — clear pending chord
      if (pendingChord) {
        pendingChord = null;
        if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      }
      return null;
    },

    /** Get all keybinding descriptions for help display */
    getBindings(): Keybinding[] {
      return bindings;
    },
  };
}
