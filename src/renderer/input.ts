/**
 * Raw stdin keypress parser — replaces Ink's useInput hook.
 */

export type KeyEvent = {
  char: string;      // printable character, or ''
  name: string;      // 'return', 'backspace', 'up', 'down', 'left', 'right', 'tab', 'escape', 'delete', or the char itself
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;  // raw bytes
};

/**
 * Start listening for raw keypress events.
 * Returns a cleanup function that restores stdin.
 */
export function startRawInput(handler: (key: KeyEvent) => void): () => void {
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const onData = (data: string) => {
    // Paste detection: multi-byte reads with newlines → treat newlines as insertable
    const isPaste = data.length > 4;
    let i = 0;
    while (i < data.length) {
      const result = parseKey(data, i);
      // During paste, convert 'return' to 'newline' so they insert instead of submit
      if (isPaste && result.event.name === 'return') {
        result.event.name = 'newline';
        result.event.char = '\n';
      }
      handler(result.event);
      i += result.consumed;
    }
  };

  process.stdin.on('data', onData);

  return () => {
    process.stdin.off('data', onData);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(wasRaw ?? false);
    }
    process.stdin.pause();
  };
}

export function parseKey(data: string, offset: number): { event: KeyEvent; consumed: number } {
  const ch = data[offset]!;
  const code = ch.charCodeAt(0);
  const seq = data.slice(offset);

  // ESC sequences
  if (code === 0x1b) {
    // Arrow keys: ESC [ A/B/C/D
    if (seq.startsWith('\x1b[A')) return { event: key('', 'up', seq.slice(0, 3)), consumed: 3 };
    if (seq.startsWith('\x1b[B')) return { event: key('', 'down', seq.slice(0, 3)), consumed: 3 };
    if (seq.startsWith('\x1b[C')) return { event: key('', 'right', seq.slice(0, 3)), consumed: 3 };
    if (seq.startsWith('\x1b[D')) return { event: key('', 'left', seq.slice(0, 3)), consumed: 3 };
    // Home/End
    if (seq.startsWith('\x1b[H')) return { event: key('', 'home', seq.slice(0, 3)), consumed: 3 };
    if (seq.startsWith('\x1b[F')) return { event: key('', 'end', seq.slice(0, 3)), consumed: 3 };
    // Delete: ESC [ 3 ~
    if (seq.startsWith('\x1b[3~')) return { event: key('', 'delete', seq.slice(0, 4)), consumed: 4 };
    // SGR mouse events: ESC [ < button ; col ; row M/m
    if (seq.startsWith('\x1b[<')) {
      const endIdx = seq.search(/[Mm]/);
      if (endIdx === -1) {
        // Partial sequence — consume entire fragment to avoid junk
        return { event: key('', 'mouse', seq), consumed: seq.length };
      }
      if (endIdx > 3) {
        const params = seq.slice(3, endIdx).split(';');
        const button = parseInt(params[0] ?? '0', 10);
        const consumed = endIdx + 1;
        // button 64 = scroll up, 65 = scroll down
        if (button === 64) return { event: key('', 'scrollup', seq.slice(0, consumed)), consumed };
        if (button === 65) return { event: key('', 'scrolldown', seq.slice(0, consumed)), consumed };
        // Ignore other mouse events (clicks, moves)
        return { event: key('', 'mouse', seq.slice(0, consumed)), consumed };
      }
    }
    // Page Up/Down: ESC [ 5 ~ / ESC [ 6 ~
    if (seq.startsWith('\x1b[5~')) return { event: key('', 'pageup', seq.slice(0, 4)), consumed: 4 };
    if (seq.startsWith('\x1b[6~')) return { event: key('', 'pagedown', seq.slice(0, 4)), consumed: 4 };
    // Shift+Arrow: ESC [ 1 ; 2 A/B/C/D
    if (seq.startsWith('\x1b[1;2A')) return { event: { char: '', name: 'up', ctrl: false, meta: false, shift: true, sequence: seq.slice(0, 6) }, consumed: 6 };
    if (seq.startsWith('\x1b[1;2B')) return { event: { char: '', name: 'down', ctrl: false, meta: false, shift: true, sequence: seq.slice(0, 6) }, consumed: 6 };
    if (seq.startsWith('\x1b[1;2C')) return { event: { char: '', name: 'right', ctrl: false, meta: false, shift: true, sequence: seq.slice(0, 6) }, consumed: 6 };
    if (seq.startsWith('\x1b[1;2D')) return { event: { char: '', name: 'left', ctrl: false, meta: false, shift: true, sequence: seq.slice(0, 6) }, consumed: 6 };
    // Alt+Enter (ESC + CR/LF) — newline insertion
    if (seq.length >= 2 && (seq[1] === '\r' || seq[1] === '\n')) {
      return { event: { char: '\n', name: 'newline', ctrl: false, meta: true, shift: false, sequence: seq.slice(0, 2) }, consumed: 2 };
    }
    // Alt+char
    if (seq.length >= 2 && seq[1]! >= ' ') {
      return { event: { char: seq[1]!, name: seq[1]!, ctrl: false, meta: true, shift: false, sequence: seq.slice(0, 2) }, consumed: 2 };
    }
    // Bare escape
    return { event: key('', 'escape', '\x1b'), consumed: 1 };
  }

  // Control characters
  if (code === 0x0d || code === 0x0a) return { event: key('', 'return', ch), consumed: 1 };
  if (code === 0x7f) return { event: key('', 'backspace', ch), consumed: 1 };
  if (code === 0x08) return { event: key('', 'backspace', ch), consumed: 1 };
  if (code === 0x09) return { event: key('', 'tab', ch), consumed: 1 };

  // Ctrl+A through Ctrl+Z (0x01 - 0x1a)
  if (code >= 0x01 && code <= 0x1a) {
    const letter = String.fromCharCode(code + 0x60); // 0x01 → 'a'
    return { event: { char: letter, name: letter, ctrl: true, meta: false, shift: false, sequence: ch }, consumed: 1 };
  }

  // Printable characters
  if (code >= 0x20 && code <= 0x7e) {
    return { event: key(ch, ch, ch), consumed: 1 };
  }

  // UTF-8 multi-byte (pass through as single char)
  return { event: key(ch, ch, ch), consumed: 1 };
}

function key(char: string, name: string, sequence: string): KeyEvent {
  return { char, name, ctrl: false, meta: false, shift: false, sequence };
}
