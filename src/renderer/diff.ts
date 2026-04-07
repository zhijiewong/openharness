/**
 * Diff rendering for CellGrid — used in the permission prompt
 * to show inline diffs for write/edit tool calls.
 */

import type { Style } from './cells.js';
import type { CellGrid } from './cells.js';
import { computeDiff, filterWithContext } from '../utils/diff-algorithm.js';
import { getTheme } from '../utils/theme-data.js';
import { existsSync, readFileSync } from 'node:fs';

const t = getTheme();
const s = (fg: string | null, bold = false, dim = false): Style => ({ fg, bg: null, bold, dim, underline: false });

const S_ADD = s(t.diffAdded);
const S_REMOVE = s(t.diffRemoved);
const S_CONTEXT = s(null, false, true);
const S_SEPARATOR = s(null, false, true);
const S_HEADER = s(null, false, true);
const S_STAT_ADD = s(t.diffAdded, true);
const S_STAT_REMOVE = s(t.diffRemoved, true);

export type DiffLine = { type: 'add' | 'remove' | 'context' | 'separator'; line: string };

export type DiffInfo = {
  filePath: string;
  oldContent: string;
  newContent: string;
  cachedDisplay?: DiffLine[];
  cachedAdds?: number;
  cachedRemoves?: number;
};

/**
 * Try to extract file info and compute diff from tool args JSON.
 * Returns null if not applicable.
 */
export function extractDiffInfo(toolName: string, argsJson: string): DiffInfo | null {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.toLowerCase();

    if (name.includes('write') && args.file_path && args.content) {
      const old = existsSync(args.file_path) ? readFileSync(args.file_path, 'utf-8') : '';
      return { filePath: args.file_path, oldContent: old, newContent: args.content };
    }

    if (name.includes('edit') && args.file_path && args.old_string && args.new_string) {
      if (existsSync(args.file_path)) {
        const old = readFileSync(args.file_path, 'utf-8');
        const newContent = old.replace(args.old_string, args.new_string);
        return { filePath: args.file_path, oldContent: old, newContent };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Render a diff into the CellGrid starting at (row, col).
 * Returns the number of rows consumed.
 */
/** Pre-compute and cache the diff for a DiffInfo. Call once, not per frame. */
export function prepareDiff(diffInfo: DiffInfo, maxLines = 20): void {
  if (diffInfo.cachedDisplay) return;
  const rawDiff = computeDiff(diffInfo.oldContent, diffInfo.newContent);
  const filtered = filterWithContext(rawDiff);
  diffInfo.cachedDisplay = filtered.slice(0, maxLines);
  diffInfo.cachedAdds = rawDiff.filter(d => d.type === 'add').length;
  diffInfo.cachedRemoves = rawDiff.filter(d => d.type === 'remove').length;
}

export function renderDiff(
  grid: CellGrid,
  row: number,
  col: number,
  diffInfo: DiffInfo,
  width: number,
  maxLines = 20,
): number {
  prepareDiff(diffInfo, maxLines);
  const display = diffInfo.cachedDisplay!;

  const adds = diffInfo.cachedAdds!;
  const removes = diffInfo.cachedRemoves!;

  let r = row;
  const maxCol = width - col;

  // Header: file path
  grid.writeText(r, col, `─── ${diffInfo.filePath} ───`, S_HEADER);
  r++;

  // Stats
  if (r < grid.height) {
    grid.writeText(r, col, `+${adds}`, S_STAT_ADD);
    grid.writeText(r, col + `+${adds}`.length, ' ', S_CONTEXT);
    grid.writeText(r, col + `+${adds}`.length + 1, `-${removes}`, S_STAT_REMOVE);
    r++;
  }

  // Diff lines
  for (const d of display) {
    if (r >= grid.height) break;

    if (d.type === 'separator') {
      grid.writeText(r, col, '  ...', S_SEPARATOR);
      r++;
      continue;
    }

    const prefix = d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  ';
    const style = d.type === 'add' ? S_ADD : d.type === 'remove' ? S_REMOVE : S_CONTEXT;
    const lineText = (prefix + d.line).slice(0, maxCol);
    grid.writeText(r, col, lineText, style);
    r++;
  }

  if (display.length >= maxLines && r < grid.height) {
    grid.writeText(r, col, `  ... (more lines)`, S_SEPARATOR);
    r++;
  }

  return r - row;
}
