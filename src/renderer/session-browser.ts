/**
 * Interactive session browser — renders in the cell grid.
 * Navigate with ↑/↓, Enter to resume, Escape to cancel.
 */

import type { Style } from './cells.js';
import type { CellGrid } from './cells.js';
import { getTheme } from '../utils/theme-data.js';
import { listSessions, loadSession } from '../harness/session.js';

type SessionSummary = ReturnType<typeof listSessions>[number];
import { homedir } from 'node:os';
import { join } from 'node:path';

const s = (fg: string | null, bold = false, dim = false): Style => ({ fg, bg: null, bold, dim, underline: false });

export type SessionBrowserState = {
  allSessions: SessionSummary[];
  sessions: SessionSummary[]; // filtered
  selectedIndex: number;
  scrollOffset: number;
  preview: string | null;
  searchQuery: string;
};

/** Load sessions and create initial browser state */
export function createSessionBrowser(): SessionBrowserState {
  const sessionDir = join(homedir(), '.oh', 'sessions');
  const allSessions = listSessions(sessionDir);
  return {
    allSessions,
    sessions: allSessions,
    selectedIndex: 0,
    scrollOffset: 0,
    preview: null,
    searchQuery: '',
  };
}

/** Update search query and filter sessions */
export function browserSearch(state: SessionBrowserState, query: string): SessionBrowserState {
  const q = query.toLowerCase();
  const filtered = q
    ? state.allSessions.filter(s =>
        s.model.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        new Date(s.updatedAt).toLocaleDateString().includes(q))
    : state.allSessions;
  return { ...state, searchQuery: query, sessions: filtered, selectedIndex: 0, scrollOffset: 0, preview: null };
}

/** Move selection up */
export function browserUp(state: SessionBrowserState): SessionBrowserState {
  const idx = Math.max(0, state.selectedIndex - 1);
  const scrollOffset = idx < state.scrollOffset ? idx : state.scrollOffset;
  return { ...state, selectedIndex: idx, scrollOffset, preview: null };
}

/** Move selection down */
export function browserDown(state: SessionBrowserState): SessionBrowserState {
  const idx = Math.min(state.sessions.length - 1, state.selectedIndex + 1);
  return { ...state, selectedIndex: idx, preview: null };
}

/** Get the selected session ID */
export function browserSelectedId(state: SessionBrowserState): string | null {
  const session = state.sessions[state.selectedIndex];
  return session?.id ?? null;
}

/** Load preview for the selected session */
export function browserLoadPreview(state: SessionBrowserState): SessionBrowserState {
  const session = state.sessions[state.selectedIndex];
  if (!session) return { ...state, preview: null };
  try {
    const sessionDir = join(homedir(), '.oh', 'sessions');
    const full = loadSession(session.id, sessionDir);
    const lastMsgs = full.messages.slice(-3);
    const preview = lastMsgs
      .map(m => `${m.role === 'user' ? '❯' : '◆'} ${m.content.slice(0, 100)}`)
      .join('\n');
    return { ...state, preview };
  } catch {
    return { ...state, preview: '[could not load preview]' };
  }
}

/**
 * Render the session browser into the cell grid.
 * Returns number of rows consumed.
 */
export function renderSessionBrowser(
  grid: CellGrid,
  row: number,
  col: number,
  state: SessionBrowserState,
  width: number,
  maxRows: number,
): number {
  const t = getTheme();
  let r = row;

  // Title + search
  grid.writeText(r, col, '─── Session Browser (↑/↓ navigate, Enter resume, Esc cancel) ───', s(null, false, true));
  r++;
  if (state.searchQuery || state.allSessions.length > 5) {
    grid.writeText(r, col, '🔍 ', s(null, false, true));
    grid.writeText(r, col + 3, state.searchQuery || '(type to filter)', state.searchQuery ? s(null) : s(null, false, true));
    r++;
  }

  if (state.sessions.length === 0) {
    grid.writeText(r, col + 2, 'No saved sessions.', s(null, false, true));
    return r - row + 1;
  }

  // Session list
  const listHeight = Math.min(maxRows - 4, state.sessions.length);
  // Adjust scroll offset
  let scrollOffset = state.scrollOffset;
  if (state.selectedIndex >= scrollOffset + listHeight) {
    scrollOffset = state.selectedIndex - listHeight + 1;
  }
  if (state.selectedIndex < scrollOffset) {
    scrollOffset = state.selectedIndex;
  }

  for (let i = 0; i < listHeight && r < row + maxRows; i++) {
    const idx = scrollOffset + i;
    if (idx >= state.sessions.length) break;
    const sess = state.sessions[idx]!;
    const selected = idx === state.selectedIndex;
    const date = new Date(sess.updatedAt).toLocaleDateString();
    const cost = sess.cost > 0 ? ` $${sess.cost.toFixed(4)}` : '';
    const model = (sess.model || '?').slice(0, 20);
    const msgs = String(sess.messages).padStart(3);

    const prefix = selected ? '▶ ' : '  ';
    const style = selected ? s(t.user, true) : s(null);
    const dimStyle = selected ? s(t.user) : s(null, false, true);

    grid.writeText(r, col, prefix, style);
    grid.writeText(r, col + 2, `${date}  ${msgs} msgs  ${model}${cost}`, dimStyle);
    if (selected) {
      grid.writeText(r, col + 2 + date.length + msgs.length + model.length + cost.length + 12,
        `  ${sess.id.slice(0, 8)}…`, s(null, false, true));
    }
    r++;
  }

  // Preview
  if (state.preview && r < row + maxRows - 1) {
    r++;
    grid.writeText(r, col, '─── Preview ───', s(null, false, true));
    r++;
    for (const line of state.preview.split('\n')) {
      if (r >= row + maxRows) break;
      grid.writeText(r, col + 2, line.slice(0, width - col - 4), s(null, false, true));
      r++;
    }
  }

  return r - row;
}
