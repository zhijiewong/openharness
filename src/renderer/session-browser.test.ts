/**
 * Tests for session browser state management.
 * Note: Does not test rendering (covered by e2e.test.ts) — tests pure state logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserSearch,
  browserUp,
  browserDown,
  browserSelectedId,
  type SessionBrowserState,
} from './session-browser.js';

function makeBrowserState(count = 5): SessionBrowserState {
  const allSessions = Array.from({ length: count }, (_, i) => ({
    id: `sess-${i}`,
    updatedAt: Date.now() - i * 60000,
    messages: i + 1,
    model: i % 2 === 0 ? 'gpt-4o' : 'claude-sonnet',
    cost: i * 0.01,
  }));
  return {
    allSessions,
    sessions: allSessions,
    selectedIndex: 0,
    scrollOffset: 0,
    preview: null,
    searchQuery: '',
  };
}

describe('Session browser state', () => {
  it('browserUp clamps at 0', () => {
    const state = makeBrowserState();
    const result = browserUp(state);
    assert.equal(result.selectedIndex, 0);
  });

  it('browserDown advances selection', () => {
    const state = makeBrowserState();
    const result = browserDown(state);
    assert.equal(result.selectedIndex, 1);
  });

  it('browserDown clamps at last session', () => {
    let state = makeBrowserState(3);
    state = browserDown(state); // 1
    state = browserDown(state); // 2
    state = browserDown(state); // still 2
    assert.equal(state.selectedIndex, 2);
  });

  it('browserSelectedId returns correct ID', () => {
    const state = makeBrowserState();
    assert.equal(browserSelectedId(state), 'sess-0');
    const next = browserDown(state);
    assert.equal(browserSelectedId(next), 'sess-1');
  });

  it('browserSelectedId returns null for empty list', () => {
    const state: SessionBrowserState = {
      allSessions: [],
      sessions: [],
      selectedIndex: 0,
      scrollOffset: 0,
      preview: null,
      searchQuery: '',
    };
    assert.equal(browserSelectedId(state), null);
  });

  it('browserSearch filters by model name', () => {
    const state = makeBrowserState(6);
    const result = browserSearch(state, 'gpt');
    assert.ok(result.sessions.length > 0);
    assert.ok(result.sessions.every(s => s.model.includes('gpt')));
    assert.equal(result.selectedIndex, 0);
    assert.equal(result.searchQuery, 'gpt');
  });

  it('browserSearch filters by session ID', () => {
    const state = makeBrowserState();
    const result = browserSearch(state, 'sess-2');
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0]!.id, 'sess-2');
  });

  it('browserSearch with empty query shows all', () => {
    const state = makeBrowserState(5);
    const filtered = browserSearch(state, 'gpt');
    const restored = browserSearch(filtered, '');
    assert.equal(restored.sessions.length, 5);
  });

  it('browserSearch resets selection and scroll', () => {
    let state = makeBrowserState();
    state = browserDown(browserDown(state)); // move to index 2
    const result = browserSearch(state, 'claude');
    assert.equal(result.selectedIndex, 0);
    assert.equal(result.scrollOffset, 0);
  });

  it('navigation clears preview', () => {
    const state = { ...makeBrowserState(), preview: 'some preview text' };
    const down = browserDown(state);
    assert.equal(down.preview, null);
    const up = browserUp(down);
    assert.equal(up.preview, null);
  });
});
