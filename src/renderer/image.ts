/**
 * Terminal image rendering.
 *
 * Supports:
 * - Kitty graphics protocol (kitty, WezTerm, Ghostty)
 * - iTerm2 inline images (iTerm2, WezTerm)
 * - Fallback: display file path and dimensions
 *
 * Detection order: TERM_PROGRAM → TERM → fallback
 */

import { IMAGE_PREFIX } from '../tools/ImageReadTool/index.js';

type ImageProtocol = 'kitty' | 'iterm' | 'none';

function detectProtocol(): ImageProtocol {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? '';
  const term = process.env.TERM?.toLowerCase() ?? '';

  if (termProgram.includes('kitty') || termProgram.includes('ghostty') || termProgram.includes('wezterm')) {
    return 'kitty';
  }
  if (termProgram.includes('iterm') || termProgram.includes('wezterm')) {
    return 'iterm';
  }
  if (term.includes('xterm-kitty')) {
    return 'kitty';
  }
  return 'none';
}

/**
 * Check if a tool output contains an image result.
 */
export function isImageOutput(output: string): boolean {
  return output.startsWith(IMAGE_PREFIX + ':');
}

/**
 * Parse an image output string into its components.
 */
function parseImageOutput(output: string): { mediaType: string; base64: string } | null {
  if (!output.startsWith(IMAGE_PREFIX + ':')) return null;
  const rest = output.slice(IMAGE_PREFIX.length + 1);
  const colonIdx = rest.indexOf(':');
  if (colonIdx < 0) return null;
  return {
    mediaType: rest.slice(0, colonIdx),
    base64: rest.slice(colonIdx + 1),
  };
}

/**
 * Render an image inline in the terminal.
 * Returns the ANSI escape sequence to display the image,
 * or a text fallback if the terminal doesn't support graphics.
 */
export function renderImageInline(
  output: string,
  maxWidth = 60,
  maxHeight = 15,
): string {
  const parsed = parseImageOutput(output);
  if (!parsed) return '[image: parse error]';

  const protocol = detectProtocol();

  if (protocol === 'kitty') {
    return renderKitty(parsed.base64, parsed.mediaType, maxWidth, maxHeight);
  }
  if (protocol === 'iterm') {
    return renderIterm(parsed.base64, maxWidth, maxHeight);
  }

  // Fallback: show info
  const sizeKB = Math.round(parsed.base64.length * 3 / 4 / 1024);
  return `[image: ${parsed.mediaType}, ${sizeKB}KB]`;
}

/**
 * Kitty graphics protocol.
 * Sends base64-encoded image data via escape sequences.
 */
function renderKitty(base64: string, mediaType: string, maxCols: number, maxRows: number): string {
  // Kitty protocol: ESC_P ... ESC\
  // a=T (transmit), f=100 (PNG), t=d (direct), c=cols, r=rows
  const chunks: string[] = [];
  const chunkSize = 4096;

  for (let i = 0; i < base64.length; i += chunkSize) {
    const chunk = base64.slice(i, i + chunkSize);
    const isLast = i + chunkSize >= base64.length;
    const more = isLast ? 0 : 1;

    if (i === 0) {
      // First chunk: include metadata
      chunks.push(`\x1b_Ga=T,f=100,t=d,c=${maxCols},r=${maxRows},m=${more};${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
  }

  return chunks.join('');
}

/**
 * iTerm2 inline image protocol.
 */
function renderIterm(base64: string, maxWidth: number, maxHeight: number): string {
  const size = base64.length;
  return `\x1b]1337;File=inline=1;size=${size};width=${maxWidth};height=${maxHeight}:${base64}\x07`;
}
