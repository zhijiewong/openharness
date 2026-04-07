/**
 * Lightweight markdown renderer for CellGrid.
 * Parses common markdown patterns (code blocks, headings, bold, lists,
 * inline code, tables) and renders them with appropriate styles.
 * No external dependencies — uses simple regex parsing.
 */

import type { Style } from './cells.js';
import type { CellGrid } from './cells.js';
import { getTheme } from '../utils/theme-data.js';

const t = getTheme();
const s = (fg: string | null, bold = false, dim = false): Style => ({ fg, bg: null, bold, dim, underline: false });

const S_TEXT = s(null);
const S_BOLD = s(null, true);
const S_HEADING = s(t.heading, true);
const S_CODE = s(t.codeBlock, false, true);
const S_CODE_FENCE = s(t.codeFence, false, true);
const S_BULLET = s(t.bullet);
const S_BLOCKQUOTE = s(null, false, true);
const S_HR = s(null, false, true);
const S_TABLE_HEADER = s(null, true);
const S_TABLE_BORDER = s(null, false, true);

type Segment = { text: string; style: Style };

/**
 * Measure how many rows markdown text will consume without rendering.
 * Uses the same logic as renderMarkdown but without writing to a grid.
 */
export function measureMarkdown(text: string, width: number): number {
  const lines = text.split('\n');
  let rows = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    if (line.trimStart().startsWith('```')) {
      rows++; // opening fence
      i++;
      while (i < lines.length) {
        if (lines[i]!.trimStart().startsWith('```')) {
          rows++; // closing fence
          i++;
          break;
        }
        rows++;
        i++;
      }
      continue;
    }

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:]*-{2,}[\s:|-]*$/.test(lines[i + 1]!)) {
      rows += 2; // header + separator
      i += 2; // skip header and separator
      while (i < lines.length && lines[i]!.includes('|')) {
        rows++;
        i++;
      }
      continue;
    }

    // Empty line or any other line = 1 row (simplified, ignoring wrapping for measurement)
    // For inline content, estimate wrapping
    const contentLen = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').length;
    rows += Math.max(1, Math.ceil((contentLen || 1) / (width - 2)));
    i++;
  }

  return rows;
}

/**
 * Render markdown text into the CellGrid starting at (row, col).
 * Returns the number of rows consumed.
 */
export function renderMarkdown(
  grid: CellGrid,
  row: number,
  col: number,
  text: string,
  width: number,
): number {
  const wrapWidth = width;
  const lines = text.split('\n');
  let r = row;
  let i = 0;

  while (i < lines.length) {
    if (r >= grid.height) break;
    const line = lines[i]!;

    // Code block (fenced)
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const fenceLabel = '```' + (lang ? ` ${lang}` : '');
      grid.writeText(r, col, fenceLabel, S_CODE_FENCE);
      r++;
      i++;

      // Render code lines until closing fence (with syntax highlighting)
      while (i < lines.length) {
        if (r >= grid.height) break;
        const codeLine = lines[i]!;
        if (codeLine.trimStart().startsWith('```')) {
          grid.writeText(r, col, '```', S_CODE_FENCE);
          r++;
          i++;
          break;
        }
        renderHighlightedCode(grid, r, col + 2, codeLine.slice(0, wrapWidth - col - 4), lang);
        r++;
        i++;
      }
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const prefix = headingMatch[1]! + ' ';
      const content = headingMatch[2]!;
      grid.writeText(r, col, prefix, S_HEADING);
      r += writeInlineMarkdown(grid, r, col + prefix.length, content, wrapWidth, S_HEADING);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      const hrLen = Math.min(40, wrapWidth - col);
      for (let c = 0; c < hrLen; c++) {
        grid.setCell(r, col + c, '─', S_HR);
      }
      r++;
      i++;
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      grid.writeText(r, col, '│ ', S_BLOCKQUOTE);
      r += writeInlineMarkdown(grid, r, col + 2, bqMatch[1]!, wrapWidth, S_BLOCKQUOTE);
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (ulMatch) {
      const indent = Math.min(ulMatch[1]!.length, 8);
      grid.writeText(r, col + indent, '• ', S_BULLET);
      r += writeInlineMarkdown(grid, r, col + indent + 2, ulMatch[3]!, wrapWidth, S_TEXT);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      const indent = Math.min(olMatch[1]!.length, 8);
      const num = olMatch[2]! + '. ';
      grid.writeText(r, col + indent, num, S_BULLET);
      r += writeInlineMarkdown(grid, r, col + indent + num.length, olMatch[3]!, wrapWidth, S_TEXT);
      i++;
      continue;
    }

    // Table detection: line with | separators
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:]*-{2,}[\s:|-]*$/.test(lines[i + 1]!)) {
      r = renderTable(grid, r, col, lines, i, wrapWidth);
      // Skip past the table: advance past header + separator first, then data rows
      i += 2; // header + separator
      while (i < lines.length && lines[i]!.includes('|')) i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      r++;
      i++;
      continue;
    }

    // Normal paragraph — render with inline formatting
    r += writeInlineMarkdown(grid, r, col, line, wrapWidth, S_TEXT);
    i++;
  }

  return r - row;
}

/**
 * Parse inline markdown (bold, inline code, links) and write to grid.
 * Returns number of rows consumed.
 */
function writeInlineMarkdown(
  grid: CellGrid,
  row: number,
  col: number,
  text: string,
  wrapWidth: number,
  baseStyle: Style,
): number {
  const segments = parseInline(text, baseStyle);
  return writeSegments(grid, row, col, segments, wrapWidth);
}

/** Parse inline markdown into styled segments */
function parseInline(text: string, baseStyle: Style): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      segments.push({ text: boldMatch[1]!, style: { ...baseStyle, bold: true } });
      remaining = remaining.slice(boldMatch[0]!.length);
      continue;
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+?)`/);
    if (codeMatch) {
      segments.push({ text: codeMatch[1]!, style: S_CODE });
      remaining = remaining.slice(codeMatch[0]!.length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      segments.push({ text: linkMatch[1]!, style: { ...baseStyle, underline: true, fg: 'cyan' } });
      segments.push({ text: ` (${linkMatch[2]!})`, style: { ...baseStyle, dim: true } });
      remaining = remaining.slice(linkMatch[0]!.length);
      continue;
    }

    // Italic: *text* (single asterisk)
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      segments.push({ text: italicMatch[1]!, style: { ...baseStyle, dim: true } });
      remaining = remaining.slice(italicMatch[0]!.length);
      continue;
    }

    // Plain text up to next special character
    const plainMatch = remaining.match(/^[^*`[]+/);
    if (plainMatch) {
      segments.push({ text: plainMatch[0]!, style: baseStyle });
      remaining = remaining.slice(plainMatch[0]!.length);
      continue;
    }

    // Single special char that didn't match a pattern
    segments.push({ text: remaining[0]!, style: baseStyle });
    remaining = remaining.slice(1);
  }

  return segments;
}

/** Write styled segments to grid with word wrapping. Returns rows consumed. */
function writeSegments(
  grid: CellGrid,
  row: number,
  startCol: number,
  segments: Segment[],
  wrapWidth: number,
): number {
  let r = row;
  let c = startCol;

  for (const seg of segments) {
    for (let i = 0; i < seg.text.length; i++) {
      if (c >= wrapWidth) {
        r++;
        c = startCol;
        if (r >= grid.height) return r - row + 1;
      }
      grid.setCell(r, c, seg.text[i]!, seg.style);
      c++;
    }
  }

  return r - row + 1;
}

/** Render a markdown table. Returns the row after the table. */
function renderTable(
  grid: CellGrid,
  row: number,
  col: number,
  lines: string[],
  startIdx: number,
  wrapWidth: number,
): number {
  let r = row;

  // Parse header
  const headerCells = parseTableRow(lines[startIdx]!);
  const separatorIdx = startIdx + 1;

  // Calculate column widths
  const colWidths = headerCells.map(c => c.length);
  const dataRows: string[][] = [];
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    if (!lines[i]!.includes('|')) break;
    const cells = parseTableRow(lines[i]!);
    dataRows.push(cells);
    for (let j = 0; j < cells.length; j++) {
      if (j < colWidths.length) {
        colWidths[j] = Math.max(colWidths[j]!, cells[j]!.length);
      }
    }
  }

  // Render header
  if (r < grid.height) {
    let c = col;
    for (let j = 0; j < headerCells.length; j++) {
      const cell = headerCells[j]!.padEnd(colWidths[j]!);
      grid.writeText(r, c, cell, S_TABLE_HEADER);
      c += colWidths[j]! + 3; // " | " separator
      if (j < headerCells.length - 1 && c - 2 < wrapWidth) {
        grid.writeText(r, c - 3, ' │ ', S_TABLE_BORDER);
      }
    }
    r++;
  }

  // Render separator
  if (r < grid.height) {
    let c = col;
    for (let j = 0; j < colWidths.length; j++) {
      for (let k = 0; k < colWidths[j]!; k++) {
        if (c + k < wrapWidth) grid.setCell(r, c + k, '─', S_TABLE_BORDER);
      }
      c += colWidths[j]! + 3;
      if (j < colWidths.length - 1 && c - 3 < wrapWidth) {
        grid.writeText(r, c - 3, '─┼─', S_TABLE_BORDER);
      }
    }
    r++;
  }

  // Render data rows
  for (const dataRow of dataRows) {
    if (r >= grid.height) break;
    let c = col;
    for (let j = 0; j < dataRow.length && j < colWidths.length; j++) {
      const cell = dataRow[j]!.padEnd(colWidths[j]!);
      grid.writeText(r, c, cell, S_TEXT);
      c += colWidths[j]! + 3;
      if (j < dataRow.length - 1 && c - 3 < wrapWidth) {
        grid.writeText(r, c - 3, ' │ ', S_TABLE_BORDER);
      }
    }
    r++;
  }

  return r;
}

/** Parse a markdown table row into cells */
function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}

// ── Syntax highlighting ──

const S_KW: Style = s(t.assistant, true);       // keywords: magenta bold
const S_STRING: Style = s(t.success);            // strings: green
const S_COMMENT: Style = s(null, false, true);   // comments: dim
const S_NUMBER: Style = s(t.tool);               // numbers: yellow
const S_TYPE: Style = s(t.user);                 // types: cyan

// Keywords for common languages
const KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'import',
  'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'yield', 'delete', 'void', 'super',
  // Python
  'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while',
  'try', 'except', 'finally', 'with', 'as', 'raise', 'pass', 'lambda', 'yield',
  'True', 'False', 'None', 'and', 'or', 'not', 'is', 'in', 'self',
  // Rust/Go/general
  'fn', 'let', 'mut', 'pub', 'impl', 'struct', 'enum', 'match', 'use', 'mod',
  'func', 'type', 'interface', 'package', 'defer', 'go', 'select', 'chan',
]);

const TYPE_KEYWORDS = new Set([
  'string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'never',
  'object', 'symbol', 'bigint', 'int', 'float', 'bool', 'str', 'i32', 'i64',
  'u32', 'u64', 'f32', 'f64', 'usize', 'isize', 'String', 'Vec', 'Option',
  'Result', 'Array', 'Map', 'Set', 'Promise', 'Record',
]);

/** Render a line of code with basic syntax highlighting */
function renderHighlightedCode(
  grid: CellGrid,
  row: number,
  col: number,
  line: string,
  lang: string,
): void {
  let c = col;
  let i = 0;

  while (i < line.length && c < grid.width) {
    // Line comments: // or #
    if ((line[i] === '/' && line[i + 1] === '/') || (line[i] === '#' && i === line.trimStart().length - line.length + line.indexOf('#'))) {
      // Check if # is a comment (not inside a string, at start after whitespace)
      const isComment = line[i] === '/' || (line[i] === '#' && line.slice(0, i).trim() === '' || line.slice(0, i).endsWith(' '));
      if (line[i] === '/' || isComment) {
        const rest = line.slice(i);
        for (let j = 0; j < rest.length && c < grid.width; j++) {
          grid.setCell(row, c, rest[j]!, S_COMMENT);
          c++;
        }
        return;
      }
    }

    // Strings: "..." or '...' or `...`
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i]!;
      grid.setCell(row, c, quote, S_STRING);
      c++; i++;
      while (i < line.length && c < grid.width) {
        grid.setCell(row, c, line[i]!, S_STRING);
        if (line[i] === quote && line[i - 1] !== '\\') { c++; i++; break; }
        c++; i++;
      }
      continue;
    }

    // Numbers
    if (/[0-9]/.test(line[i]!) && (i === 0 || /[\s(,=+\-*/<>[\]{}:;!&|^~%]/.test(line[i - 1]!))) {
      while (i < line.length && c < grid.width && /[0-9._xXa-fA-F]/.test(line[i]!)) {
        grid.setCell(row, c, line[i]!, S_NUMBER);
        c++; i++;
      }
      continue;
    }

    // Words (identifiers/keywords)
    if (/[a-zA-Z_$]/.test(line[i]!)) {
      const start = i;
      while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i]!)) i++;
      const word = line.slice(start, i);
      const style = KEYWORDS.has(word) ? S_KW : TYPE_KEYWORDS.has(word) ? S_TYPE : S_CODE;
      for (let j = 0; j < word.length && c < grid.width; j++) {
        grid.setCell(row, c, word[j]!, style);
        c++;
      }
      continue;
    }

    // Everything else
    grid.setCell(row, c, line[i]!, S_CODE);
    c++; i++;
  }
}
