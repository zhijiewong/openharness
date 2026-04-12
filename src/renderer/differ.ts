/**
 * Cell-level differ — compares two CellGrids and produces minimal ANSI output.
 */

import type { CellGrid, Style } from "./cells.js";
import { cellsEqual } from "./cells.js";
import { BG_CODES, FG_CODES } from "./colors.js";

/** Convert a Style to an SGR escape sequence */
export function styleToSGR(style: Style): string {
  const codes: number[] = [0]; // reset first
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.underline) codes.push(4);
  if (style.fg && FG_CODES[style.fg]) codes.push(FG_CODES[style.fg]!);
  if (style.bg && BG_CODES[style.bg]) codes.push(BG_CODES[style.bg]!);
  return `\x1b[${codes.join(";")}m`;
}

/**
 * Compare two grids and return the ANSI string that transforms prev into next.
 * Only emits escape sequences for changed cells.
 */
export function diff(prev: CellGrid, next: CellGrid, rowOffset = 0): string {
  const parts: string[] = [];
  let lastStyle: string | null = null;
  let expectedRow = -1;
  let expectedCol = -1;

  for (let r = 0; r < next.height; r++) {
    for (let c = 0; c < next.width; c++) {
      const prevCell = r < prev.height && c < prev.width ? prev.cells[r]![c]! : null;
      const nextCell = next.cells[r]![c]!;

      if (prevCell && cellsEqual(prevCell, nextCell)) continue;

      // Position cursor if not already there
      if (r !== expectedRow || c !== expectedCol) {
        parts.push(`\x1b[${r + 1 + rowOffset};${c + 1}H`);
      }

      // Apply style if changed
      const sgr = styleToSGR(nextCell.style);
      if (sgr !== lastStyle) {
        parts.push(sgr);
        lastStyle = sgr;
      }

      parts.push(nextCell.char);
      expectedRow = r;
      expectedCol = c + 1;
    }
  }

  // Reset style at end
  if (parts.length > 0) {
    parts.push("\x1b[0m");
  }

  return parts.join("");
}

/**
 * Write ANSI output wrapped in DEC 2026 synchronized output markers.
 * Terminals that support this will buffer all output and paint atomically.
 */
export function syncWrite(output: string): void {
  if (!output) return;
  process.stdout.write(`\x1b[?2026h${output}\x1b[?2026l`);
}

/** Clear the entire screen */
export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Hide cursor */
export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

/** Show cursor */
export function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

/** Move cursor to position */
export function moveCursor(row: number, col: number): void {
  process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
}
