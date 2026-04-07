/**
 * Layout engine — rasterizes application state into a CellGrid.
 * Split screen: messages area (top) + footer (bottom).
 */

import type { Message } from '../types/message.js';
import type { Style } from './cells.js';
import { CellGrid, EMPTY_STYLE } from './cells.js';
import { renderMarkdown, measureMarkdown } from './markdown.js';
import { renderDiff } from './diff.js';

export type ToolCallInfo = {
  toolName: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  args?: string;
  liveOutput?: string[];
};

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
  statusLine: string;
  contextWarning: { text: string; critical: boolean } | null;
  errorText: string | null;
  loading: boolean;
  spinnerFrame: number;
  thinkingStartedAt: number | null;
  tokenCount: number;
  vimMode: 'normal' | 'insert' | null;
  permissionBox: { toolName: string; description: string; riskLevel: string; suggestion: string | null } | null;
  permissionDiffVisible: boolean;
  permissionDiffInfo: import('./diff.js').DiffInfo | null;
  expandedToolCalls: Set<string>;
  questionPrompt: { question: string; options: string[] | null; input: string; cursor: number } | null;
};

// Styles
const S_USER: Style = { fg: 'cyan', bg: null, bold: true, dim: false, underline: false };
const S_ASSISTANT: Style = { fg: 'magenta', bg: null, bold: true, dim: false, underline: false };
const S_TEXT: Style = { fg: null, bg: null, bold: false, dim: false, underline: false };
const S_DIM: Style = { fg: null, bg: null, bold: false, dim: true, underline: false };
const S_ERROR: Style = { fg: 'red', bg: null, bold: false, dim: false, underline: false };
const S_YELLOW: Style = { fg: 'yellow', bg: null, bold: false, dim: false, underline: false };
const S_GREEN: Style = { fg: 'green', bg: null, bold: false, dim: false, underline: false };
const S_BORDER: Style = { fg: null, bg: null, bold: false, dim: true, underline: false };

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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

  // Footer height: border(1) + status(1) + input(1) + hints(1) = 4, companion takes at most 7 rows
  // Permission box adds 5 more rows when active
  const companionHeight = state.companionLines ? state.companionLines.length + 1 : 0;
  const diffHeight = (state.permissionDiffVisible && state.permissionDiffInfo) ? 20 : 0;
  const permissionHeight = state.permissionBox ? 6 + diffHeight : 0;
  const questionHeight = state.questionPrompt ? 4 + (state.questionPrompt.options?.length ?? 0) : 0;
  const statusLineHeight = state.statusLine ? 1 : 0;
  const contextWarningHeight = state.contextWarning ? 1 : 0;
  const footerHeight = Math.max(3 + statusLineHeight, companionHeight + 1) + permissionHeight + questionHeight + contextWarningHeight;
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

  // Thinking text rendered directly below (shimmer effect needs per-char styling)

  // Spinner rendered directly below (shimmer effect needs per-char styling)

  // Add error
  if (state.errorText) {
    allContent.push({ role: 'error', content: state.errorText, style: S_ERROR, prefixStyle: S_ERROR, prefix: '✗ ' });
  }

  // Render messages top-down (scroll up when content exceeds area)
  const prefixLen = 2;
  const textWidth = w - prefixLen;

  // Pre-compute total height to handle scrolling
  let totalRows = 0;
  for (const item of allContent) {
    if (item.role === 'user' && totalRows > 0) totalRows++;
    if (item.role === 'assistant' || item.role === 'streaming') {
      totalRows += measureMarkdown(item.content, w);
    } else {
      const lines = item.content.split('\n');
      for (const line of lines) {
        totalRows += Math.max(1, Math.ceil((line.length || 1) / textWidth));
      }
    }
  }

  // If content exceeds area, scroll: offset so latest content is visible at bottom
  const scrollOffset = totalRows > msgAreaHeight ? totalRows - msgAreaHeight : 0;
  let r = 0;
  let virtualR = 0; // tracks position before scroll clipping
  let contentIdx = 0;

  for (const item of allContent) {
    if (r >= msgAreaHeight) break;

    // Divider before user messages (except first)
    if (item.role === 'user' && contentIdx > 0) {
      if (virtualR >= scrollOffset) {
        for (let c = 0; c < w; c++) {
          grid.setCell(r, c, '─', S_BORDER);
        }
        r++;
      }
      virtualR++;
    }

    // Compute how many rows this content will take
    let itemRows: number;
    if (item.role === 'assistant' || item.role === 'streaming') {
      itemRows = measureMarkdown(item.content, w);
    } else {
      const lines = item.content.split('\n');
      itemRows = 0;
      for (const line of lines) {
        itemRows += Math.max(1, Math.ceil((line.length || 1) / textWidth));
      }
    }

    if (virtualR + itemRows <= scrollOffset) {
      // Entirely above viewport — skip
      virtualR += itemRows;
      contentIdx++;
      continue;
    }

    // Write prefix
    grid.writeText(r, 0, item.prefix, item.prefixStyle);

    // Write content — use markdown renderer for assistant messages
    let rows: number;
    if (item.role === 'assistant' || item.role === 'streaming') {
      rows = renderMarkdown(grid, r, prefixLen, item.content, w);
    } else {
      rows = grid.writeWrapped(r, prefixLen, item.content, item.style, w);
    }
    r += rows;
    virtualR += itemRows;
    contentIdx++;
  }

  // ── Thinking text with shimmer ──
  if (state.thinkingText && r < msgAreaHeight) {
    const thinkLines = state.thinkingText.split('\n').slice(-3);
    const shimmerPos = state.spinnerFrame % 20;
    const S_BRIGHT: Style = { fg: null, bg: null, bold: false, dim: false, underline: false };
    for (const tLine of thinkLines) {
      if (r >= msgAreaHeight) break;
      grid.writeText(r, 0, '💭 ', S_DIM);
      const chars = [...tLine];
      for (let ci = 0; ci < chars.length && ci + 3 < w; ci++) {
        grid.setCell(r, 3 + ci, chars[ci]!, Math.abs(ci - shimmerPos) <= 2 ? S_BRIGHT : S_DIM);
      }
      r++;
    }
  }

  // ── Shimmer spinner ──
  if (state.loading && !state.streamingText && !state.thinkingText && r < msgAreaHeight) {
    const thinkText = 'Thinking';
    const elapsed = state.thinkingStartedAt ? Math.floor((Date.now() - state.thinkingStartedAt) / 1000) : 0;

    // Color transitions: magenta → yellow (30s+) → red (60s+)
    const baseColor = elapsed > 60 ? 'red' : elapsed > 30 ? 'yellow' : 'magenta';
    const shimmerColor = elapsed > 60 ? 'brightRed' : elapsed > 30 ? 'brightYellow' : 'brightMagenta';
    const baseStyle: Style = { fg: baseColor, bg: null, bold: false, dim: false, underline: false };

    // Prefix
    const prefixStyle: Style = { ...baseStyle, bold: true };
    grid.writeText(r, 0, '◆ ', prefixStyle);

    // Shimmer effect: bright color sweeps across text
    const shimmerPos = state.spinnerFrame % (thinkText.length + 6);
    const shimmerStyle: Style = { fg: shimmerColor, bg: null, bold: true, dim: false, underline: false };
    for (let ci = 0; ci < thinkText.length; ci++) {
      grid.setCell(r, 2 + ci, thinkText[ci]!, Math.abs(ci - shimmerPos) <= 1 ? shimmerStyle : baseStyle);
    }

    // Suffix: elapsed + tokens
    let suffix = '';
    if (elapsed > 0) suffix += ` ${elapsed}s`;
    if (state.tokenCount > 0) {
      const tokStr = state.tokenCount >= 1000 ? `${(state.tokenCount / 1000).toFixed(1)}K` : `${state.tokenCount}`;
      suffix += ` | ${tokStr} tokens`;
    }
    suffix += '...';
    grid.writeText(r, 2 + thinkText.length, suffix, S_DIM);
    r++;
  }

  // ── Tool calls (below messages, above footer) ──
  for (const [callId, tc] of state.toolCalls) {
    if (r >= msgAreaHeight) break;
    const icon = tc.status === 'running' ? '⠋' : tc.status === 'done' ? '✓' : '✗';
    const statusStyle = tc.status === 'error' ? S_ERROR : tc.status === 'done' ? S_GREEN : S_YELLOW;
    const isExpanded = state.expandedToolCalls.has(callId);
    const canExpand = tc.status !== 'running' && tc.output;

    // Collapse/expand indicator
    if (canExpand) {
      grid.writeText(r, 0, isExpanded ? '▼' : '▶', S_DIM);
    }
    grid.writeText(r, 2, `${icon} `, statusStyle);
    grid.writeText(r, 4, tc.toolName, { ...S_YELLOW, bold: true });
    // Show args preview on the same line
    if (tc.args) {
      const argsStart = 4 + tc.toolName.length + 1;
      const maxArgs = w - argsStart - 2;
      if (maxArgs > 5) {
        const argsText = tc.args.slice(0, maxArgs) + (tc.args.length > maxArgs ? '…' : '');
        grid.writeText(r, argsStart, argsText, S_DIM);
      }
    }
    r++;

    // Live streaming output while running
    if (tc.status === 'running' && tc.liveOutput && tc.liveOutput.length > 0) {
      const maxLines = 5;
      const overflow = tc.liveOutput.length > maxLines ? tc.liveOutput.length - maxLines : 0;
      if (overflow > 0 && r < msgAreaHeight) {
        grid.writeText(r, 6, `… (${overflow} earlier lines)`, S_DIM);
        r++;
      }
      const visible = overflow > 0 ? tc.liveOutput.slice(-maxLines) : tc.liveOutput;
      for (const line of visible) {
        if (r >= msgAreaHeight) break;
        grid.writeText(r, 6, line.slice(0, w - 8), S_DIM);
        r++;
      }
    }

    // Final output after completion
    if (tc.output && tc.status !== 'running' && r < msgAreaHeight) {
      const outLines = tc.output.split('\n');
      const maxOut = isExpanded ? 20 : 3;
      const showLines = outLines.slice(0, maxOut);
      for (const line of showLines) {
        if (r >= msgAreaHeight) break;
        const lineStyle = tc.status === 'error' ? S_ERROR : S_DIM;
        grid.writeText(r, 6, line.slice(0, w - 8), lineStyle);
        r++;
      }
      if (outLines.length > maxOut && r < msgAreaHeight) {
        grid.writeText(r, 6, `… (${outLines.length} lines total)`, S_DIM);
        r++;
      }
    }
  }

  // ── Context warning (above footer) ──
  if (state.contextWarning) {
    if (r < msgAreaHeight) {
      const warnStyle: Style = { fg: 'yellow', bg: null, bold: state.contextWarning.critical, dim: false, underline: false };
      grid.writeText(r, 0, state.contextWarning.text, warnStyle);
      r++;
    }
  }

  // ── Footer — place right after content, or at bottom if content fills the screen ──
  const footerStart = Math.min(r, msgAreaHeight);

  // Border line
  for (let c = 0; c < w; c++) {
    grid.setCell(footerStart, c, '─', S_BORDER);
  }

  let nextRow = footerStart + 1;

  // Permission prompt box (if active)
  if (state.permissionBox) {
    const { toolName, description, riskLevel } = state.permissionBox;
    const riskColor = riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'yellow' : 'green';
    const riskStyle: Style = { fg: riskColor, bg: null, bold: true, dim: false, underline: false };
    const riskDim: Style = { fg: riskColor, bg: null, bold: false, dim: true, underline: false };

    // Top border
    const boxWidth = Math.min(w - 2, 70);
    grid.writeText(nextRow, 1, '╭' + '─'.repeat(boxWidth - 2) + '╮', riskDim);
    nextRow++;

    // Tool name + risk
    grid.writeText(nextRow, 1, '│ ', riskDim);
    grid.writeText(nextRow, 3, '⚠ ', riskStyle);
    grid.writeText(nextRow, 5, toolName, { ...riskStyle });
    grid.writeText(nextRow, 5 + toolName.length, ` ${riskLevel} risk`, S_DIM);
    grid.writeText(nextRow, boxWidth, '│', riskDim);
    nextRow++;

    // Description (truncated)
    const descText = state.permissionBox.suggestion || description.slice(0, boxWidth - 6);
    grid.writeText(nextRow, 1, '│ ', riskDim);
    grid.writeText(nextRow, 3, descText.slice(0, boxWidth - 4), S_DIM);
    grid.writeText(nextRow, boxWidth, '│', riskDim);
    nextRow++;

    // Inline diff (when toggled)
    if (state.permissionDiffVisible && state.permissionDiffInfo) {
      grid.writeText(nextRow, 1, '│', riskDim);
      nextRow++;
      const diffRows = renderDiff(grid, nextRow, 3, state.permissionDiffInfo, boxWidth - 2, 15);
      // Draw left border for diff rows
      for (let dr = 0; dr < diffRows; dr++) {
        if (nextRow + dr < grid.height) {
          grid.setCell(nextRow + dr, 1, '│', riskDim);
          grid.setCell(nextRow + dr, boxWidth, '│', riskDim);
        }
      }
      nextRow += diffRows;
    }

    // Action keys
    const hasDiff = state.permissionDiffInfo !== null;
    grid.writeText(nextRow, 1, '│ ', riskDim);
    grid.writeText(nextRow, 3, '[', S_TEXT);
    grid.writeText(nextRow, 4, 'Y', S_GREEN);
    grid.writeText(nextRow, 5, ']es  [', S_TEXT);
    grid.writeText(nextRow, 11, 'N', S_ERROR);
    grid.writeText(nextRow, 12, ']o', S_TEXT);
    if (hasDiff) {
      grid.writeText(nextRow, 15, '[', S_TEXT);
      grid.writeText(nextRow, 16, 'D', { fg: 'cyan', bg: null, bold: true, dim: false, underline: false });
      grid.writeText(nextRow, 17, ']iff', S_TEXT);
    }
    grid.writeText(nextRow, boxWidth, '│', riskDim);
    nextRow++;

    // Bottom border
    grid.writeText(nextRow, 1, '╰' + '─'.repeat(boxWidth - 2) + '╯', riskDim);
    nextRow++;
  }

  // Question prompt (if active)
  let questionInputRow = -1;
  if (state.questionPrompt) {
    const { question, options, input, cursor } = state.questionPrompt;
    const qStyle: Style = { fg: 'yellow', bg: null, bold: false, dim: false, underline: false };
    const qBorder: Style = { fg: 'yellow', bg: null, bold: false, dim: true, underline: false };
    const qBoxWidth = Math.min(w - 2, 70);

    grid.writeText(nextRow, 1, '╭' + '─'.repeat(qBoxWidth - 2) + '╮', qBorder);
    nextRow++;
    grid.writeText(nextRow, 1, '│ ', qBorder);
    grid.writeText(nextRow, 3, `❓ ${question}`, qStyle);
    grid.writeText(nextRow, qBoxWidth, '│', qBorder);
    nextRow++;

    if (options && options.length > 0) {
      for (let oi = 0; oi < options.length; oi++) {
        grid.writeText(nextRow, 1, '│ ', qBorder);
        grid.writeText(nextRow, 5, `${oi + 1}. ${options[oi]}`, S_DIM);
        grid.writeText(nextRow, qBoxWidth, '│', qBorder);
        nextRow++;
      }
    }

    questionInputRow = nextRow;
    grid.writeText(nextRow, 1, '│ ', qBorder);
    grid.writeText(nextRow, 3, '❯ ', qStyle);
    grid.writeText(nextRow, 5, input, S_TEXT);
    grid.writeText(nextRow, qBoxWidth, '│', qBorder);
    nextRow++;
    grid.writeText(nextRow, 1, '╰' + '─'.repeat(qBoxWidth - 2) + '╯', qBorder);
    nextRow++;
  }

  // Status line (model | tokens | cost)
  if (state.statusLine) {
    grid.writeText(nextRow, 0, state.statusLine, S_DIM);
    nextRow++;
  }

  // Input line
  const inputRow = nextRow;
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
    const compStyle: Style = { fg: state.companionColor || 'cyan', bg: null, bold: false, dim: false, underline: false };
    for (let i = 0; i < state.companionLines.length; i++) {
      const compRow = footerStart + i;
      if (compRow >= h) break;
      grid.writeText(compRow, compStartCol, state.companionLines[i]!, compStyle);
    }
  }

  // Position cursor: in question input if active, otherwise in main input
  if (state.questionPrompt && questionInputRow >= 0) {
    return {
      cursorRow: questionInputRow,
      cursorCol: 5 + state.questionPrompt.cursor,
    };
  }

  return {
    cursorRow: inputRow,
    cursorCol: inputStart + state.inputCursor,
  };
}

/** Extract a human-readable suggestion from tool args */
export function extractSuggestionFromArgs(toolName: string, description: string): string | null {
  const lower = toolName.toLowerCase();
  if (lower === 'bash' || lower === 'shell') {
    const cmdMatch = description.match(/command[:\s]+["`]?(.+?)["`]?(?:\n|$)/i);
    if (cmdMatch) return `$ ${cmdMatch[1]}`;
    try {
      const args = JSON.parse(description);
      if (args.command) return `$ ${args.command.slice(0, 60)}`;
    } catch { /* ignore */ }
  }
  if (lower.includes('read') || lower.includes('write') || lower.includes('edit') || lower.includes('glob') || lower.includes('grep')) {
    try {
      const args = JSON.parse(description);
      if (args.file_path) {
        const action = lower.includes('read') ? 'reading' : lower.includes('write') ? 'writing' : lower.includes('edit') ? 'editing' : lower;
        return `${action} ${args.file_path}`;
      }
      if (args.pattern) return `pattern: ${args.pattern}`;
    } catch { /* ignore */ }
  }
  return null;
}
