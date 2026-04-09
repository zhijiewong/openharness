/**
 * Layout engine — rasterizes application state into a CellGrid.
 * Split screen: messages area (top) + footer (bottom).
 */

import type { Message } from '../types/message.js';
import type { Style } from './cells.js';
import { CellGrid, EMPTY_STYLE } from './cells.js';
import { renderMarkdown, measureMarkdown } from './markdown.js';
import { renderDiff } from './diff.js';
import { isImageOutput, renderImageInline } from './image.js';
import { renderSessionBrowser } from './session-browser.js';
import { getTheme, type Theme } from '../utils/theme-data.js';

export type ToolCallInfo = {
  toolName: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  args?: string;
  isAgent?: boolean;
  agentDescription?: string;
  liveOutput?: string[];
  startedAt?: number; // timestamp for elapsed display
  resultSummary?: string; // e.g., "42 lines" or "exit 0"
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
  autocomplete: string[]; // slash command name suggestions
  autocompleteDescriptions: string[]; // matching descriptions
  autocompleteIndex: number; // -1 = none selected
  manualScroll: number; // 0 = auto-scroll to bottom, >0 = scrolled up by N rows
  codeBlocksExpanded: boolean; // false = collapse long code blocks to 3 lines
  sessionBrowser: import('./session-browser.js').SessionBrowserState | null;
  bannerLines: string[] | null;
  thinkingExpanded: boolean;
  lastThinkingSummary: string | null; // e.g., "∴ Thinking (2.1s, 856 tokens)"
};

// Styles
// Style helper
const s = (fg: string | null, bold = false, dim = false): Style => ({ fg, bg: null, bold, dim, underline: false });

// Theme-independent styles
const S_TEXT = s(null);
const S_DIM = s(null, false, true);
const S_BORDER = s(null, false, true);

// Theme-dependent styles — lazily initialized on first rasterize() call
let S_USER: Style;
let S_ASSISTANT: Style;
let S_ERROR: Style;
let S_YELLOW: Style;
let S_GREEN: Style;
let _stylesInit = false;

/** Reset style cache — call after theme change */
export function resetStyleCache() {
  _stylesInit = false;
}

function ensureStyles() {
  if (_stylesInit) return;
  _stylesInit = true;
  const t = getTheme();
  S_USER = s(t.user, true);
  S_ASSISTANT = s(t.assistant, true);
  S_ERROR = s(t.error);
  S_YELLOW = s(t.tool);
  S_GREEN = s(t.success);
}

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Rasterize application state into the cell grid.
 * Returns cursor position for the input line.
 */
export function rasterize(
  state: LayoutState,
  grid: CellGrid,
): { cursorRow: number; cursorCol: number } {
  ensureStyles();
  const w = grid.width;
  const h = grid.height;

  // Footer height — capped at 50% of terminal to preserve message area
  const companionHeight = state.companionLines ? Math.min(state.companionLines.length + 1, 8) : 0;
  const maxDiffHeight = Math.min(15, Math.floor(h / 3));
  const diffHeight = (state.permissionDiffVisible && state.permissionDiffInfo) ? maxDiffHeight : 0;
  const permissionHeight = state.permissionBox ? 6 + diffHeight : 0;
  const questionHeight = state.questionPrompt ? 4 + (state.questionPrompt.options?.length ?? 0) : 0;
  const statusLineHeight = state.statusLine ? 1 : 0;
  const contextWarningHeight = state.contextWarning ? 1 : 0;
  const autocompleteHeight = state.autocomplete.length;
  const inputLineCount = Math.min(5, (state.inputText.match(/\n/g)?.length ?? 0) + 1);
  const rawFooterHeight = Math.max(2 + inputLineCount + statusLineHeight + autocompleteHeight, companionHeight + 1) + permissionHeight + questionHeight + contextWarningHeight;
  const footerHeight = Math.min(rawFooterHeight, Math.floor(h / 2));
  const msgAreaHeight = Math.max(1, h - footerHeight);

  // ── Session browser overlay ──
  if (state.sessionBrowser) {
    const browserRows = renderSessionBrowser(grid, 0, 0, state.sessionBrowser, w, msgAreaHeight);
    // Skip normal message rendering — show browser instead
    const footerStart = Math.min(browserRows, msgAreaHeight);
    // Render minimal footer (just input)
    for (let c = 0; c < w; c++) grid.setCell(footerStart, c, '─', S_BORDER);
    const inputRow = footerStart + 1;
    grid.writeText(inputRow, 0, '❯ ', S_USER);
    grid.writeText(inputRow + 1, 0, '↑/↓ navigate | Enter resume | Esc cancel', S_DIM);
    return { cursorRow: inputRow, cursorCol: 2 };
  }

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
  const contentWidth = w - 1; // reserve rightmost column for scrollbar
  const textWidth = contentWidth - prefixLen;

  // Pre-compute total height to handle scrolling
  let totalRows = 0;
  // Banner height (compact on small terminals, hidden if very small)
  if (state.bannerLines && h >= 30) {
    const compact = h < 40;
    const visibleLines = compact ? Math.min(2, state.bannerLines.length) : state.bannerLines.length;
    totalRows += visibleLines + 1; // +1 blank line after
  }
  for (const item of allContent) {
    if (item.role === 'user' && totalRows > 0) totalRows++;
    if (item.role === 'assistant' || item.role === 'streaming') {
      totalRows += measureMarkdown(item.content, contentWidth);
    } else {
      const lines = item.content.split('\n');
      for (const line of lines) {
        totalRows += Math.max(1, Math.ceil((line.length || 1) / textWidth));
      }
    }
  }

  // Include non-message content in totalRows for accurate scroll indicator
  if (state.thinkingText) {
    totalRows += state.thinkingExpanded ? Math.min(state.thinkingText.split('\n').length, 10) : 1;
  }
  if (!state.loading && state.lastThinkingSummary) totalRows += 1;
  if (state.loading && !state.streamingText && !state.thinkingText) totalRows += 1; // spinner
  for (const [callId, tc] of state.toolCalls) {
    totalRows += 1; // tool header line
    if (tc.isAgent && tc.agentDescription) totalRows += 1; // agent description line
    if (tc.status === 'running' && tc.liveOutput) totalRows += Math.min(tc.liveOutput.length, 5);
    // Collapsed tools show 0 output lines; expanded show up to 20
    if (tc.output && tc.status !== 'running' && state.expandedToolCalls.has(callId)) {
      totalRows += Math.min(tc.output.split('\n').length, 20);
    }
  }
  if (state.contextWarning) totalRows += 1;

  // If content exceeds area, scroll: offset so latest content is visible at bottom
  // manualScroll > 0 means user scrolled up by that many rows
  const autoOffset = totalRows > msgAreaHeight ? totalRows - msgAreaHeight : 0;
  const scrollOffset = Math.max(0, autoOffset - state.manualScroll);

  // Scrollbar geometry (rightmost column of message area)
  const hasScrollbar = totalRows > msgAreaHeight;
  let thumbStart = 0;
  let thumbSize = msgAreaHeight;
  if (hasScrollbar) {
    thumbSize = Math.max(1, Math.round((msgAreaHeight / totalRows) * msgAreaHeight));
    thumbStart = Math.round((scrollOffset / Math.max(1, totalRows)) * (msgAreaHeight - thumbSize));
  }

  let r = 0;
  let virtualR = 0; // tracks position before scroll clipping
  let contentIdx = 0;

  // ── Banner (ASCII art at top) ──
  if (state.bannerLines && h >= 30) {
    const S_BANNER = s('cyan');
    const S_BANNER_DIM = s(null, false, true);
    // On small terminals, show only the last 2 lines (version + cwd info)
    const compact = h < 40;
    const startLine = compact ? Math.max(0, state.bannerLines.length - 2) : 0;
    for (let i = startLine; i < state.bannerLines.length; i++) {
      if (virtualR >= scrollOffset && r < msgAreaHeight) {
        const line = state.bannerLines[i]!;
        const isBannerArt = i < state.bannerLines.length - 2;
        grid.writeText(r, 0, line, isBannerArt ? S_BANNER : S_BANNER_DIM);
        r++;
      }
      virtualR++;
    }
    // Blank line after banner
    if (virtualR >= scrollOffset && r < msgAreaHeight) {
      r++;
    }
    virtualR++;
  }

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
      itemRows = measureMarkdown(item.content, contentWidth);
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
      rows = renderMarkdown(grid, r, prefixLen, item.content, contentWidth, state.codeBlocksExpanded, msgAreaHeight);
    } else {
      rows = grid.writeWrapped(r, prefixLen, item.content, item.style, contentWidth, msgAreaHeight);
    }
    r += rows;
    virtualR += itemRows;
    contentIdx++;
  }

  // ── Thinking text with shimmer (live) ──
  if (state.thinkingText && r < msgAreaHeight) {
    if (state.thinkingExpanded) {
      // Show full thinking text (last 10 lines)
      const thinkLines = state.thinkingText.split('\n').slice(-10);
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
    } else {
      // Collapsed: single line with live indicator
      const lineCount = state.thinkingText.split('\n').length;
      const elapsed = state.thinkingStartedAt ? Math.floor((Date.now() - state.thinkingStartedAt) / 1000) : 0;
      const summary = `∴ Thinking${elapsed > 0 ? ` (${elapsed}s)` : ''} — ${lineCount} lines [Ctrl+O expand]`;
      grid.writeText(r, 0, summary, S_DIM);
      r++;
    }
  }

  // ── Collapsed thinking summary (after completion) ──
  if (!state.loading && state.lastThinkingSummary && r < msgAreaHeight) {
    if (state.thinkingExpanded) {
      // Expanded mode not applicable after completion since text was cleared
      grid.writeText(r, 0, state.lastThinkingSummary, S_DIM);
      r++;
    } else {
      grid.writeText(r, 0, state.lastThinkingSummary, S_DIM);
      r++;
    }
  }

  // ── Shimmer spinner ──
  if (state.loading && !state.streamingText && !state.thinkingText && r < msgAreaHeight) {
    const thinkText = 'Thinking';
    const elapsed = state.thinkingStartedAt ? Math.floor((Date.now() - state.thinkingStartedAt) / 1000) : 0;

    // Color transitions: magenta → yellow (30s+) → red (60s+)
    const t = getTheme();
    const baseColor = elapsed > 60 ? t.error : elapsed > 30 ? t.stall : t.primary;
    const shimmerColor = elapsed > 60 ? t.stallShimmer : elapsed > 30 ? t.warning : t.primaryShimmer;
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
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const isAgent = tc.isAgent || tc.toolName === 'Agent' || tc.toolName === 'ParallelAgents';

    // Agent-specific icons and colors
    const icon = isAgent
      ? (tc.status === 'running' ? '⊕' : tc.status === 'done' ? '◈' : '◇')
      : (tc.status === 'running' ? spinnerChars[state.spinnerFrame % spinnerChars.length]! : tc.status === 'done' ? '✓' : '✗');
    const S_AGENT: Style = { fg: 'cyan', bg: null, bold: true, dim: false, underline: false };
    const statusStyle = tc.status === 'error' ? S_ERROR : tc.status === 'done' ? S_GREEN : isAgent ? S_AGENT : S_YELLOW;
    const nameStyle = isAgent ? S_AGENT : { ...S_YELLOW, bold: true };
    const isExpanded = state.expandedToolCalls.has(callId);
    const canExpand = tc.status !== 'running' && tc.output;

    // Collapse/expand indicator
    if (canExpand) {
      grid.writeText(r, 0, isExpanded ? '▼' : '▶', S_DIM);
    }
    grid.writeText(r, 2, `${icon} `, statusStyle);
    grid.writeText(r, 4, tc.toolName, nameStyle);

    // Show args + elapsed time on the same line
    let afterName = 4 + tc.toolName.length + 1;
    if (tc.args) {
      const maxArgs = w - afterName - 15; // leave room for elapsed
      if (maxArgs > 5) {
        const argsText = tc.args.slice(0, maxArgs) + (tc.args.length > maxArgs ? '…' : '');
        grid.writeText(r, afterName, argsText, S_DIM);
        afterName += argsText.length + 1;
      }
    }
    // Elapsed time for running tools
    if (tc.status === 'running' && tc.startedAt) {
      const elapsed = Math.floor((Date.now() - tc.startedAt) / 1000);
      if (elapsed > 0) {
        const lineCount = tc.liveOutput?.length ?? 0;
        const elapsedStr = lineCount > 0 ? `${elapsed}s · ${lineCount} lines` : `${elapsed}s`;
        grid.writeText(r, Math.min(afterName, w - elapsedStr.length - 2), elapsedStr, S_DIM);
      }
    }
    // Result summary for completed tools (e.g., "42 lines", "exit 0")
    if (tc.status !== 'running' && tc.resultSummary) {
      const elapsed = tc.startedAt ? Math.floor((Date.now() - tc.startedAt) / 1000) : 0;
      const suffix = elapsed > 0 ? `${tc.resultSummary} · ${elapsed}s` : tc.resultSummary;
      grid.writeText(r, Math.min(afterName, w - suffix.length - 2), suffix, S_DIM);
    }
    r++;

    // Agent description line
    if (isAgent && tc.agentDescription && r < msgAreaHeight) {
      grid.writeText(r, 6, tc.agentDescription.slice(0, w - 8), S_DIM);
      r++;
    }

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

    // Final output — collapsed by default (only show when expanded via Tab)
    if (tc.output && tc.status !== 'running' && isExpanded && r < msgAreaHeight) {
      // Image results: show inline placeholder
      if (isImageOutput(tc.output)) {
        const label = renderImageInline(tc.output);
        grid.writeText(r, 6, label.slice(0, w - 8), S_DIM);
        r++;
        continue;
      }
      const outLines = tc.output.split('\n');
      const maxOut = 20;
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

  // ── Scrollbar (right edge of message area) ──
  if (hasScrollbar) {
    const S_TRACK: Style = { fg: null, bg: null, bold: false, dim: true, underline: false };
    const S_THUMB: Style = { fg: null, bg: null, bold: false, dim: false, underline: false };
    for (let sr = 0; sr < msgAreaHeight; sr++) {
      const isThumb = sr >= thumbStart && sr < thumbStart + thumbSize;
      grid.setCell(sr, w - 1, isThumb ? '█' : '░', isThumb ? S_THUMB : S_TRACK);
    }
  }

  // ── Footer — place right after content, or at bottom if content fills the screen ──
  const footerStart = Math.min(r, msgAreaHeight);

  // Border line with scroll indicator
  for (let c = 0; c < w; c++) {
    grid.setCell(footerStart, c, '─', S_BORDER);
  }
  // Connect scrollbar to footer border
  if (hasScrollbar) {
    grid.setCell(footerStart, w - 1, '┤', S_BORDER);
  }
  if (state.manualScroll > 0 && totalRows > msgAreaHeight) {
    // User scrolled up — show how many lines are hidden below
    const hiddenBelow = state.manualScroll;
    const indicator = ` ↓ ${hiddenBelow} more below `;
    const startCol = Math.max(0, Math.floor((w - indicator.length) / 2));
    grid.writeText(footerStart, startCol, indicator, S_DIM);
  } else if (totalRows > msgAreaHeight && scrollOffset > 0) {
    // Content overflows but auto-scrolled to bottom — show lines hidden above
    const indicator = ` ↑ ${scrollOffset} more above `;
    const startCol = Math.max(0, Math.floor((w - indicator.length) / 2));
    grid.writeText(footerStart, startCol, indicator, S_DIM);
  }

  let nextRow = footerStart + 1;

  // Permission prompt box (if active, skip if terminal too small)
  // Ensure at least 6 rows available for the box (tool + desc + keys + borders)
  if (state.permissionBox && w >= 20 && (h - nextRow) >= 6) {
    const { toolName, description, riskLevel } = state.permissionBox;
    const riskColor = riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'yellow' : 'green';
    const riskStyle: Style = { fg: riskColor, bg: null, bold: true, dim: false, underline: false };
    const riskDim: Style = { fg: riskColor, bg: null, bold: false, dim: true, underline: false };

    // Top border
    const boxWidth = Math.max(15, Math.min(w - 2, 70));
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
    const rawDesc = state.permissionBox.suggestion || description.slice(0, boxWidth - 6);
    const descText = rawDesc.replace(/\|/g, ' ').replace(/\\/g, '/'); // sanitize pipe/backslash for display
    grid.writeText(nextRow, 1, '│ ', riskDim);
    grid.writeText(nextRow, 3, descText.slice(0, boxWidth - 4), S_DIM);
    grid.writeText(nextRow, boxWidth, '│', riskDim);
    nextRow++;

    // Inline diff (when toggled, capped to available space)
    if (state.permissionDiffVisible && state.permissionDiffInfo && nextRow + 3 < h) {
      grid.writeText(nextRow, 1, '│', riskDim);
      nextRow++;
      const availDiffRows = Math.min(maxDiffHeight, h - nextRow - 3); // reserve 3 for keys + border + input
      const diffRows = renderDiff(grid, nextRow, 3, state.permissionDiffInfo, boxWidth - 2, availDiffRows);
      // Draw left border for diff rows
      for (let dr = 0; dr < diffRows; dr++) {
        if (nextRow + dr < grid.height) {
          grid.setCell(nextRow + dr, 1, '│', riskDim);
          grid.setCell(nextRow + dr, boxWidth, '│', riskDim);
        }
      }
      nextRow += diffRows;
    }

    // Action keys — prominent colored letters
    const hasDiff = state.permissionDiffInfo !== null;
    const S_KEY_GREEN: Style = { fg: 'green', bg: null, bold: true, dim: false, underline: false };
    const S_KEY_RED: Style = { fg: 'red', bg: null, bold: true, dim: false, underline: false };
    const S_KEY_CYAN: Style = { fg: 'cyan', bg: null, bold: true, dim: false, underline: false };
    grid.writeText(nextRow, 1, '│ ', riskDim);
    let kc = 3;
    grid.writeText(nextRow, kc, 'Y', S_KEY_GREEN); kc += 1;
    grid.writeText(nextRow, kc, 'es', S_DIM); kc += 2;
    grid.writeText(nextRow, kc, '  ', S_DIM); kc += 2;
    grid.writeText(nextRow, kc, 'N', S_KEY_RED); kc += 1;
    grid.writeText(nextRow, kc, 'o', S_DIM); kc += 1;
    if (hasDiff) {
      grid.writeText(nextRow, kc, '  ', S_DIM); kc += 2;
      grid.writeText(nextRow, kc, 'D', S_KEY_CYAN); kc += 1;
      grid.writeText(nextRow, kc, 'iff', S_DIM); kc += 3;
    }
    grid.writeText(nextRow, boxWidth, '│', riskDim);
    nextRow++;

    // Bottom border
    grid.writeText(nextRow, 1, '╰' + '─'.repeat(boxWidth - 2) + '╯', riskDim);
    nextRow++;
  }

  // Question prompt (if active)
  let questionInputRow = -1;
  if (state.questionPrompt && w >= 20) {
    const { question, options, input, cursor } = state.questionPrompt;
    const qStyle: Style = { fg: 'yellow', bg: null, bold: false, dim: false, underline: false };
    const qBorder: Style = { fg: 'yellow', bg: null, bold: false, dim: true, underline: false };
    const qBoxWidth = Math.max(15, Math.min(w - 2, 70));

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

  // Pre-compute prompt width for alignment
  const vimIndicator = state.vimMode ? (state.vimMode === 'normal' ? '[N] ' : '[I] ') : '';
  const promptText = vimIndicator + '❯ ';
  const promptWidth = promptText.length;

  // Autocomplete suggestions (above input, aligned to prompt)
  if (state.autocomplete.length > 0) {
    for (let ai = 0; ai < state.autocomplete.length; ai++) {
      const cmd = state.autocomplete[ai]!;
      const desc = state.autocompleteDescriptions[ai] ?? '';
      const selected = ai === state.autocompleteIndex;
      const acStyle = selected
        ? s(getTheme().user, true)
        : s(null, false, true);
      grid.writeText(nextRow, promptWidth, `/${cmd.padEnd(12)}`, acStyle);
      if (desc && w > promptWidth + 15) grid.writeText(nextRow, promptWidth + 13, desc.slice(0, w - promptWidth - 15), S_DIM);
      nextRow++;
    }
  }

  // Input line
  const inputRow = nextRow;
  let inputStart: number;
  {
    grid.writeText(inputRow, 0, promptText, S_USER);
    inputStart = promptWidth;
    // Multi-line input rendering
    const inputLines = state.inputText.split('\n');
    const maxInputLines = Math.min(inputLines.length, 5);
    for (let li = 0; li < maxInputLines; li++) {
      if (li === 0) {
        grid.writeText(inputRow, inputStart, inputLines[0]!, S_TEXT);
      } else {
        // Align continuation to prompt position
        grid.writeText(inputRow + li, inputStart, inputLines[li]!, S_TEXT);
      }
    }
    // Hints
    const hintsRow = inputRow + maxInputLines;
    const hintsText = inputLines.length > 1
      ? `${state.statusHints} | Alt+Enter newline`
      : state.statusHints;
    grid.writeText(hintsRow, 0, hintsText, S_DIM);
  }

  // Companion (right-aligned in footer, skipped if it would overlap input)
  if (state.companionLines && w >= 50) {
    const compWidth = Math.max(...state.companionLines.map(l => l.length), 0);
    const compStartCol = Math.max(0, w - compWidth - 1);
    const inputEndCol = promptWidth + (state.inputText.split('\n')[0]?.length ?? 0);
    // Only render if companion has horizontal clearance from input
    if (compStartCol > inputEndCol + 3) {
      const compStyle: Style = { fg: state.companionColor || 'cyan', bg: null, bold: false, dim: false, underline: false };
      for (let i = 0; i < state.companionLines.length; i++) {
        const compRow = footerStart + i;
        // Skip rows that would overlap with input/status area
        if (compRow >= inputRow) break;
        if (compRow >= h) break;
        grid.writeText(compRow, compStartCol, state.companionLines[i]!, compStyle);
      }
    }
  }

  // Position cursor: in question input if active, otherwise in main input
  if (state.questionPrompt && questionInputRow >= 0) {
    return {
      cursorRow: questionInputRow,
      cursorCol: 5 + state.questionPrompt.cursor,
    };
  }


  // 2D cursor positioning for multi-line input (all lines aligned to inputStart)
  const textBeforeCursor = state.inputText.slice(0, state.inputCursor);
  const cursorLines = textBeforeCursor.split('\n');
  const cursorLineIdx = Math.min(cursorLines.length - 1, 4); // capped at 5 visible lines
  const cursorColInLine = cursorLines[cursorLines.length - 1]!.length;
  return {
    cursorRow: inputRow + cursorLineIdx,
    cursorCol: inputStart + cursorColInLine,
  };
}

// extractSuggestion moved to shared utils/tool-summary.ts as summarizeToolArgs

/**
 * Rasterize only the "live area" — streaming text, thinking, tool calls, and footer.
 * Used in hybrid mode where completed messages are flushed to terminal scrollback.
 * The grid should be sized to fit just the live content.
 */
export function rasterizeLive(
  state: LayoutState,
  grid: CellGrid,
): { cursorRow: number; cursorCol: number } {
  ensureStyles();
  const w = grid.width;
  const h = grid.height;
  let r = 0;

  // ── Streaming text ──
  if (state.loading && state.streamingText) {
    grid.writeText(r, 0, '◆ ', S_ASSISTANT);
    const rows = renderMarkdown(grid, r, 2, state.streamingText, w, state.codeBlocksExpanded, h);
    r += rows;
  }

  // ── Thinking (live shimmer) ──
  if (state.thinkingText && r < h) {
    if (state.thinkingExpanded) {
      const thinkLines = state.thinkingText.split('\n').slice(-10);
      const shimmerPos = state.spinnerFrame % 20;
      const S_BRIGHT: Style = { fg: null, bg: null, bold: false, dim: false, underline: false };
      for (const tLine of thinkLines) {
        if (r >= h) break;
        grid.writeText(r, 0, '💭 ', S_DIM);
        const chars = [...tLine];
        for (let ci = 0; ci < chars.length && ci + 3 < w; ci++) {
          grid.setCell(r, 3 + ci, chars[ci]!, Math.abs(ci - shimmerPos) <= 2 ? S_BRIGHT : S_DIM);
        }
        r++;
      }
    } else {
      const lineCount = state.thinkingText.split('\n').length;
      const elapsed = state.thinkingStartedAt ? Math.floor((Date.now() - state.thinkingStartedAt) / 1000) : 0;
      const summary = `∴ Thinking${elapsed > 0 ? ` (${elapsed}s)` : ''} — ${lineCount} lines [Ctrl+O expand]`;
      grid.writeText(r, 0, summary, S_DIM);
      r++;
    }
  }

  // ── Thinking summary (after completion) ──
  if (!state.loading && state.lastThinkingSummary && r < h) {
    grid.writeText(r, 0, state.lastThinkingSummary, S_DIM);
    r++;
  }

  // ── Spinner ──
  if (state.loading && !state.streamingText && !state.thinkingText && r < h) {
    const thinkText = 'Thinking';
    const elapsed = state.thinkingStartedAt ? Math.floor((Date.now() - state.thinkingStartedAt) / 1000) : 0;
    const t = getTheme();
    const baseColor = elapsed > 60 ? t.error : elapsed > 30 ? t.stall : t.primary;
    const shimmerColor = elapsed > 60 ? t.stallShimmer : elapsed > 30 ? t.warning : t.primaryShimmer;
    const baseStyle: Style = { fg: baseColor, bg: null, bold: false, dim: false, underline: false };
    grid.writeText(r, 0, '◆ ', { ...baseStyle, bold: true });
    const shimmerPos = state.spinnerFrame % (thinkText.length + 6);
    const shimmerStyle: Style = { fg: shimmerColor, bg: null, bold: true, dim: false, underline: false };
    for (let ci = 0; ci < thinkText.length; ci++) {
      grid.setCell(r, 2 + ci, thinkText[ci]!, Math.abs(ci - shimmerPos) <= 1 ? shimmerStyle : baseStyle);
    }
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

  // ── Error ──
  if (state.errorText && r < h) {
    grid.writeText(r, 0, '✗ ', S_ERROR);
    grid.writeText(r, 2, state.errorText.slice(0, w - 4), S_ERROR);
    r++;
  }

  // ── Tool calls ──
  for (const [callId, tc] of state.toolCalls) {
    if (r >= h) break;
    const isAgent = tc.isAgent || tc.toolName === 'Agent' || tc.toolName === 'ParallelAgents';
    const icon = isAgent
      ? (tc.status === 'running' ? '⊕' : tc.status === 'done' ? '◈' : '◇')
      : (tc.status === 'running' ? SPINNER_CHARS[state.spinnerFrame % SPINNER_CHARS.length]! : tc.status === 'done' ? '✓' : '✗');
    const S_AGENT: Style = { fg: 'cyan', bg: null, bold: true, dim: false, underline: false };
    const statusStyle = tc.status === 'error' ? S_ERROR : tc.status === 'done' ? S_GREEN : isAgent ? S_AGENT : S_YELLOW;
    const nameStyle = isAgent ? S_AGENT : { ...S_YELLOW, bold: true };
    const isExpanded = state.expandedToolCalls.has(callId);

    grid.writeText(r, 0, isExpanded ? '▼' : '▶', S_DIM);
    grid.writeText(r, 2, `${icon} `, statusStyle);
    grid.writeText(r, 4, tc.toolName, nameStyle);
    let afterName = 4 + tc.toolName.length + 1;
    if (tc.args) {
      const maxArgs = w - afterName - 15;
      if (maxArgs > 5) {
        const argsText = tc.args.slice(0, maxArgs) + (tc.args.length > maxArgs ? '…' : '');
        grid.writeText(r, afterName, argsText, S_DIM);
        afterName += argsText.length + 1;
      }
    }
    if (tc.resultSummary && tc.status !== 'running') {
      grid.writeText(r, Math.min(afterName, w - tc.resultSummary.length - 2), tc.resultSummary, S_DIM);
    }
    r++;
    if (isAgent && tc.agentDescription && r < h) {
      grid.writeText(r, 6, tc.agentDescription.slice(0, w - 8), S_DIM);
      r++;
    }
    // Live output while running
    if (tc.status === 'running' && tc.liveOutput && tc.liveOutput.length > 0) {
      const visible = tc.liveOutput.slice(-3);
      for (const line of visible) {
        if (r >= h) break;
        grid.writeText(r, 6, line.slice(0, w - 8), S_DIM);
        r++;
      }
    }
    // Expanded output
    if (tc.output && tc.status !== 'running' && isExpanded && r < h) {
      const outLines = tc.output.split('\n').slice(0, 20);
      for (const line of outLines) {
        if (r >= h) break;
        grid.writeText(r, 6, line.slice(0, w - 8), tc.status === 'error' ? S_ERROR : S_DIM);
        r++;
      }
    }
  }

  // ── Context warning ──
  if (state.contextWarning && r < h) {
    const warnStyle: Style = { fg: 'yellow', bg: null, bold: state.contextWarning.critical, dim: false, underline: false };
    grid.writeText(r, 0, state.contextWarning.text, warnStyle);
    r++;
  }

  // ── Footer border ──
  if (r < h) {
    for (let c = 0; c < w; c++) grid.setCell(r, c, '─', S_BORDER);
    r++;
  }

  let nextRow = r;

  // ── Permission box ──
  let questionInputRow = -1;
  if (state.permissionBox && w >= 20 && (h - nextRow) >= 4) {
    const { toolName, riskLevel } = state.permissionBox;
    const riskColor = riskLevel === 'high' ? 'red' : riskLevel === 'medium' ? 'yellow' : 'green';
    const riskStyle: Style = { fg: riskColor, bg: null, bold: true, dim: false, underline: false };
    grid.writeText(nextRow, 1, `⚠ ${toolName} (${riskLevel} risk)`, riskStyle);
    nextRow++;
    const S_KEY_GREEN: Style = { fg: 'green', bg: null, bold: true, dim: false, underline: false };
    const S_KEY_RED: Style = { fg: 'red', bg: null, bold: true, dim: false, underline: false };
    grid.writeText(nextRow, 1, 'Y', S_KEY_GREEN);
    grid.writeText(nextRow, 2, 'es  ', S_DIM);
    grid.writeText(nextRow, 6, 'N', S_KEY_RED);
    grid.writeText(nextRow, 7, 'o', S_DIM);
    if (state.permissionDiffInfo) {
      const S_KEY_CYAN: Style = { fg: 'cyan', bg: null, bold: true, dim: false, underline: false };
      grid.writeText(nextRow, 10, 'D', S_KEY_CYAN);
      grid.writeText(nextRow, 11, 'iff', S_DIM);
    }
    nextRow++;
    // Inline diff (when toggled)
    if (state.permissionDiffVisible && state.permissionDiffInfo && nextRow + 3 < h) {
      const availDiffRows = Math.min(15, h - nextRow - 3);
      const diffRows = renderDiff(grid, nextRow, 3, state.permissionDiffInfo, Math.min(w - 2, 70), availDiffRows);
      nextRow += diffRows;
    }
  }

  // ── Question prompt ──
  if (state.questionPrompt && w >= 20 && (h - nextRow) >= 3) {
    grid.writeText(nextRow, 1, `❓ ${state.questionPrompt.question}`, S_TEXT);
    nextRow++;
    if (state.questionPrompt.options) {
      for (const opt of state.questionPrompt.options) {
        if (nextRow >= h) break;
        grid.writeText(nextRow, 3, opt, S_DIM);
        nextRow++;
      }
    }
    questionInputRow = nextRow;
    grid.writeText(nextRow, 1, '❯ ', S_USER);
    grid.writeText(nextRow, 3, state.questionPrompt.input, S_TEXT);
    nextRow++;
  }

  // ── Status line ──
  if (state.statusLine && nextRow < h) {
    grid.writeText(nextRow, 0, state.statusLine, S_DIM);
    nextRow++;
  }

  // ── Autocomplete ──
  const vimIndicator = state.vimMode ? (state.vimMode === 'normal' ? '[N] ' : '[I] ') : '';
  const promptText = vimIndicator + '❯ ';
  const promptWidth = promptText.length;
  if (state.autocomplete.length > 0) {
    for (let ai = 0; ai < state.autocomplete.length; ai++) {
      if (nextRow >= h) break;
      const cmd = state.autocomplete[ai]!;
      const desc = state.autocompleteDescriptions[ai] ?? '';
      const selected = ai === state.autocompleteIndex;
      const acStyle = selected ? s(getTheme().user, true) : s(null, false, true);
      grid.writeText(nextRow, promptWidth, `/${cmd.padEnd(12)}`, acStyle);
      if (desc && w > promptWidth + 15) grid.writeText(nextRow, promptWidth + 13, desc.slice(0, w - promptWidth - 15), S_DIM);
      nextRow++;
    }
  }

  // ── Input line ──
  const inputRow = nextRow;
  let inputStart: number;
  {
    grid.writeText(inputRow, 0, promptText, S_USER);
    inputStart = promptWidth;
    const inputLines = state.inputText.split('\n');
    const maxInputLines = Math.min(inputLines.length, 5);
    for (let li = 0; li < maxInputLines; li++) {
      if (inputRow + li >= h) break;
      if (li === 0) {
        grid.writeText(inputRow, inputStart, inputLines[0]!, S_TEXT);
      } else {
        grid.writeText(inputRow + li, inputStart, inputLines[li]!, S_TEXT);
      }
    }
    const hintsRow = inputRow + maxInputLines;
    if (hintsRow < h) {
      const hintsText = inputLines.length > 1 ? `${state.statusHints} | Alt+Enter newline` : state.statusHints;
      grid.writeText(hintsRow, 0, hintsText, S_DIM);
    }
  }

  // ── Companion (right-aligned, anchored at footer border area) ──
  if (state.companionLines && w >= 50) {
    const compWidth = Math.max(...state.companionLines.map(l => l.length), 0);
    const compStartCol = Math.max(0, w - compWidth - 1);
    if (compStartCol > promptWidth + 20) {
      const compStyle: Style = { fg: state.companionColor || 'cyan', bg: null, bold: false, dim: false, underline: false };
      // Place companion starting at the border row, right-aligned
      const borderRow = r; // r is at the border line position
      for (let i = 0; i < state.companionLines.length; i++) {
        const compRow = borderRow + i;
        if (compRow >= h) break;
        grid.writeText(compRow, compStartCol, state.companionLines[i]!, compStyle);
      }
    }
  }

  // ── Cursor position ──
  if (state.questionPrompt && questionInputRow >= 0) {
    return { cursorRow: questionInputRow, cursorCol: 3 + state.questionPrompt.cursor };
  }
  const textBeforeCursor = state.inputText.slice(0, state.inputCursor);
  const cursorLines = textBeforeCursor.split('\n');
  const cursorLineIdx = Math.min(cursorLines.length - 1, 4);
  const cursorColInLine = cursorLines[cursorLines.length - 1]!.length;
  return { cursorRow: inputRow + cursorLineIdx, cursorCol: inputStart + cursorColInLine };
}
