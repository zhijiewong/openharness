/**
 * Layout engine — rasterizes application state into a CellGrid.
 * Split screen: messages area (top) + footer (bottom).
 */

import type { Message } from '../types/message.js';
import type { Style } from './cells.js';
import { CellGrid, EMPTY_STYLE } from './cells.js';

export type ToolCallInfo = { toolName: string; status: string; output?: string };

export type LayoutState = {
  messages: Message[];
  streamingText: string;
  thinkingText: string;
  toolCalls: Map<string, ToolCallInfo>;
  inputText: string;
  inputCursor: number;
  companionLines: string[] | null;
  companionColor: string;
  statusHints: string;
  errorText: string | null;
  loading: boolean;
  spinnerFrame: number;
  vimMode: 'normal' | 'insert' | null;
};

// Styles
const S_USER: Style = { fg: 'cyan', bg: null, bold: true, dim: false };
const S_ASSISTANT: Style = { fg: 'magenta', bg: null, bold: true, dim: false };
const S_TEXT: Style = { fg: null, bg: null, bold: false, dim: false };
const S_DIM: Style = { fg: null, bg: null, bold: false, dim: true };
const S_ERROR: Style = { fg: 'red', bg: null, bold: false, dim: false };
const S_YELLOW: Style = { fg: 'yellow', bg: null, bold: false, dim: false };
const S_BORDER: Style = { fg: null, bg: null, bold: false, dim: true };

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Compute how many rows a message will occupy when word-wrapped.
 */
function messageHeight(msg: Message, width: number): number {
  const prefix = msg.role === 'user' ? 2 : msg.role === 'assistant' ? 2 : 2;
  const textWidth = width - prefix;
  if (textWidth <= 0) return 1;
  const lines = msg.content.split('\n');
  let rows = 0;
  for (const line of lines) {
    rows += Math.max(1, Math.ceil((line.length || 1) / textWidth));
  }
  return rows;
}

/**
 * Rasterize application state into the cell grid.
 * Returns cursor position for the input line.
 */
export function rasterize(
  state: LayoutState,
  grid: CellGrid,
): { cursorRow: number; cursorCol: number } {
  const w = grid.width;
  const h = grid.height;

  // Footer height: input (2) + hints (1) = 3, companion takes at most 7 rows
  const companionHeight = state.companionLines ? state.companionLines.length + 1 : 0;
  const footerHeight = Math.max(3, companionHeight + 1);
  const msgAreaHeight = h - footerHeight;

  // ── Messages area (top) ──
  // Compute total height of all messages + streaming
  const allContent: Array<{ role: string; content: string; style: Style; prefixStyle: Style; prefix: string }> = [];

  for (const msg of state.messages) {
    if (msg.role === 'user') {
      allContent.push({ role: 'user', content: msg.content, style: { ...S_TEXT, bold: true }, prefixStyle: S_USER, prefix: '❯ ' });
    } else if (msg.role === 'assistant') {
      allContent.push({ role: 'assistant', content: msg.content, style: S_TEXT, prefixStyle: S_ASSISTANT, prefix: '◆ ' });
    } else if (msg.role === 'system') {
      allContent.push({ role: 'system', content: msg.content, style: S_DIM, prefixStyle: S_DIM, prefix: '  ' });
    }
  }

  // Add streaming text
  if (state.loading && state.streamingText) {
    allContent.push({ role: 'streaming', content: state.streamingText, style: S_TEXT, prefixStyle: S_ASSISTANT, prefix: '◆ ' });
  }

  // Add thinking text
  if (state.thinkingText) {
    const lastLines = state.thinkingText.split('\n').slice(-3).join('\n');
    allContent.push({ role: 'thinking', content: lastLines, style: S_DIM, prefixStyle: S_DIM, prefix: '💭 ' });
  }

  // Add spinner
  if (state.loading && !state.streamingText && !state.thinkingText) {
    const frame = SPINNER_CHARS[state.spinnerFrame % SPINNER_CHARS.length]!;
    allContent.push({ role: 'spinner', content: `${frame} Thinking...`, style: S_ASSISTANT, prefixStyle: S_ASSISTANT, prefix: '' });
  }

  // Add error
  if (state.errorText) {
    allContent.push({ role: 'error', content: state.errorText, style: S_ERROR, prefixStyle: S_ERROR, prefix: '✗ ' });
  }

  // Render messages bottom-aligned: compute total rows, then offset
  const prefixLen = 2;
  const textWidth = w - prefixLen;
  let totalRows = 0;
  const rowCounts: number[] = [];
  for (const item of allContent) {
    // Add divider row for user messages (except first)
    if (item.role === 'user' && totalRows > 0) totalRows++;
    const lines = item.content.split('\n');
    let rows = 0;
    for (const line of lines) {
      rows += Math.max(1, Math.ceil((line.length || 1) / textWidth));
    }
    rowCounts.push(rows);
    totalRows += rows;
  }

  // Start row: bottom-align within msgAreaHeight
  let r = Math.max(0, msgAreaHeight - totalRows);
  let contentIdx = 0;

  for (const item of allContent) {
    if (r >= msgAreaHeight) break;

    // Divider before user messages (except first)
    if (item.role === 'user' && contentIdx > 0) {
      const divLen = Math.min(60, w);
      for (let c = 0; c < divLen; c++) {
        grid.setCell(r, c, '─', S_DIM);
      }
      r++;
    }

    // Write prefix
    grid.writeText(r, 0, item.prefix, item.prefixStyle);

    // Write content word-wrapped
    const rows = grid.writeWrapped(r, prefixLen, item.content, item.style, w);
    r += rows;
    contentIdx++;
  }

  // ── Tool calls (below messages, above footer) ──
  for (const [, tc] of state.toolCalls) {
    if (r >= msgAreaHeight) break;
    const icon = tc.status === 'running' ? '⏳' : tc.status === 'done' ? '✓' : '✗';
    const errorStyle = tc.status === 'error' ? S_ERROR : S_YELLOW;
    grid.writeText(r, 2, `${icon} ${tc.toolName}`, errorStyle);
    r++;
    // Show truncated output for completed tools
    if (tc.output && r < msgAreaHeight) {
      const outLine = tc.output.split('\n')[0]?.slice(0, w - 6) ?? '';
      grid.writeText(r, 4, outLine, S_DIM);
      r++;
    }
  }

  // ── Footer ──
  const footerStart = msgAreaHeight;

  // Border line
  const borderLen = Math.min(60, w);
  for (let c = 0; c < borderLen; c++) {
    grid.setCell(footerStart, c, '─', S_BORDER);
  }

  // Input line
  const inputRow = footerStart + 1;
  const vimIndicator = state.vimMode ? (state.vimMode === 'normal' ? '[N] ' : '[I] ') : '';
  const prompt = vimIndicator + '❯ ';
  grid.writeText(inputRow, 0, prompt, S_USER);
  const inputStart = prompt.length;
  grid.writeText(inputRow, inputStart, state.inputText, S_TEXT);

  // Hints
  grid.writeText(inputRow + 1, 0, state.statusHints, S_DIM);

  // Companion (right-aligned in footer)
  if (state.companionLines && w >= 40) {
    const compWidth = Math.max(...state.companionLines.map(l => l.length), 0);
    const compStartCol = w - compWidth - 1;
    const compStyle: Style = { fg: state.companionColor || 'cyan', bg: null, bold: false, dim: false };
    for (let i = 0; i < state.companionLines.length; i++) {
      const compRow = footerStart + i;
      if (compRow >= h) break;
      grid.writeText(compRow, compStartCol, state.companionLines[i]!, compStyle);
    }
  }

  return {
    cursorRow: inputRow,
    cursorCol: inputStart + state.inputCursor,
  };
}
