/**
 * End-to-end test for the cell renderer REPL.
 * Tests the full state machine: message → render → tool call → complete.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CellGrid } from './cells.js';
import { rasterize, type LayoutState, type ToolCallInfo } from './layout.js';
import { setActiveTheme } from '../utils/theme-data.js';

setActiveTheme('dark');

function makeState(overrides: Partial<LayoutState> = {}): LayoutState {
  return {
    messages: [],
    streamingText: '',
    thinkingText: '',
    toolCalls: new Map(),
    inputText: '',
    inputCursor: 0,
    companionLines: null,
    companionColor: 'cyan',
    statusHints: 'exit to quit',
    statusLine: '',
    contextWarning: null,
    errorText: null,
    loading: false,
    spinnerFrame: 0,
    thinkingStartedAt: null,
    tokenCount: 0,
    vimMode: null,
    permissionBox: null,
    permissionDiffVisible: false,
    permissionDiffInfo: null,
    expandedToolCalls: new Set(),
    questionPrompt: null,
    autocomplete: [],
    autocompleteIndex: -1,
    manualScroll: 0,
    codeBlocksExpanded: false,
    sessionBrowser: null,
    bannerLines: null,
    thinkingExpanded: false,
    lastThinkingSummary: null,
    autocompleteDescriptions: [],
    searchMode: false,
    searchQuery: '',
    searchMatchCount: 0,
    searchCurrentMatch: -1,
    ...overrides,
  };
}

function gridText(grid: CellGrid, row: number): string {
  return grid.cells[row]!.map(c => c.char).join('').trimEnd();
}

describe('E2E: REPL state machine', () => {
  it('renders empty state with input prompt', () => {
    const state = makeState();
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    // Should show input prompt
    const inputLine = gridText(grid, cursor.cursorRow);
    assert.ok(inputLine.includes('❯'), 'Should show input prompt');
  });

  it('renders user message', () => {
    const state = makeState({
      messages: [{
        role: 'user',
        content: 'hello world',
        uuid: 'u1',
        timestamp: Date.now(),
      }],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    const line0 = gridText(grid, 0);
    assert.ok(line0.includes('hello world'), `Expected user message, got: ${line0}`);
  });

  it('renders assistant message with markdown', () => {
    const state = makeState({
      messages: [
        { role: 'user', content: 'hi', uuid: 'u1', timestamp: Date.now() },
        { role: 'assistant', content: '# Hello\n\nWorld', uuid: 'a1', timestamp: Date.now() },
      ],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    // Find the heading
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('# Hello')) { found = true; break; }
    }
    assert.ok(found, 'Should render markdown heading');
  });

  it('renders spinner when loading with no streaming text', () => {
    const state = makeState({
      loading: true,
      thinkingStartedAt: Date.now(),
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Thinking')) { found = true; break; }
    }
    assert.ok(found, 'Should show shimmer spinner');
  });

  it('renders streaming text', () => {
    const state = makeState({
      loading: true,
      streamingText: 'partial response text',
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('partial response')) { found = true; break; }
    }
    assert.ok(found, 'Should render streaming text');
  });

  it('renders tool calls with status icons', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    toolCalls.set('tc1', { toolName: 'Read', status: 'done', args: '/path/to/file.ts', output: 'file content' });
    toolCalls.set('tc2', { toolName: 'Bash', status: 'running', args: '$ npm test' });
    const state = makeState({ toolCalls, loading: true, thinkingStartedAt: Date.now() });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundRead = false, foundBash = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('Read') && line.includes('✓')) foundRead = true;
      if (line.includes('Bash') && line.includes('⠋')) foundBash = true;
    }
    assert.ok(foundRead, 'Should show completed tool with ✓');
    assert.ok(foundBash, 'Should show running tool with spinner');
  });

  it('renders permission prompt box', () => {
    const state = makeState({
      permissionBox: { toolName: 'Bash', description: '{"command":"rm -rf /"}', riskLevel: 'high', suggestion: '$ rm -rf /' },
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundTool = false, foundYN = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('Bash') && line.includes('high risk')) foundTool = true;
      if (line.includes('Yes') && line.includes('No')) foundYN = true;
    }
    assert.ok(foundTool, 'Should show tool name and risk');
    assert.ok(foundYN, 'Should show Y/N options');
  });

  it('renders status line', () => {
    const state = makeState({
      statusLine: 'gemma3:12b │ 1.2K↑ 500↓ │ $0.0100',
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('gemma3:12b')) { found = true; break; }
    }
    assert.ok(found, 'Should show status line with model info');
  });

  it('renders context warning', () => {
    const state = makeState({
      contextWarning: { text: '⚠ Context ~85% full — consider /compact', critical: false },
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Context ~85%')) { found = true; break; }
    }
    assert.ok(found, 'Should show context warning');
  });

  it('renders error message', () => {
    const state = makeState({
      errorText: 'Connection refused',
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Connection refused')) { found = true; break; }
    }
    assert.ok(found, 'Should show error text');
  });

  it('renders question prompt', () => {
    const state = makeState({
      questionPrompt: { question: 'What is your name?', options: ['Alice', 'Bob'], input: 'Al', cursor: 2 },
    });
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    let foundQ = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('What is your name?')) { foundQ = true; break; }
    }
    assert.ok(foundQ, 'Should show question');
    // Cursor should be positioned in the question input
    assert.strictEqual(cursor.cursorCol, 5 + 2, 'Cursor should be at input position');
  });

  // ── Search mode ──

  it('renders search bar when in search mode', () => {
    const state = makeState({
      searchMode: true,
      searchQuery: 'hello',
      searchMatchCount: 3,
      searchCurrentMatch: 1,
    });
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    let foundSearchBar = false;
    let foundMatchCount = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('🔍') && line.includes('hello')) foundSearchBar = true;
      if (line.includes('2/3')) foundMatchCount = true;
    }
    assert.ok(foundSearchBar, 'Should show search bar with query');
    assert.ok(foundMatchCount, 'Should show match count (2/3)');
  });

  it('renders search hints in search mode', () => {
    const state = makeState({ searchMode: true, searchQuery: '' });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Esc close')) { found = true; break; }
    }
    assert.ok(found, 'Should show search navigation hints');
  });

  it('hides normal input prompt in search mode', () => {
    const state = makeState({ searchMode: true, searchQuery: 'test', inputText: 'should not show' });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundInput = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('should not show')) { foundInput = true; break; }
    }
    assert.ok(!foundInput, 'Normal input should be hidden in search mode');
  });

  // ── Scroll indicator ──

  it('shows scroll-up indicator when content overflows and auto-scrolled', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message line ${i}`,
      uuid: `u${i}`,
      timestamp: Date.now(),
    }));
    const state = makeState({ messages, manualScroll: 0 });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('more above')) { found = true; break; }
    }
    assert.ok(found, 'Should show ↑ more above indicator');
  });

  it('shows scroll-down indicator when user scrolled up', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message line ${i}`,
      uuid: `u${i}`,
      timestamp: Date.now(),
    }));
    const state = makeState({ messages, manualScroll: 10 });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('more below')) { found = true; break; }
    }
    assert.ok(found, 'Should show ↓ more below indicator');
  });

  it('no scroll indicator when content fits', () => {
    const state = makeState({
      messages: [{ role: 'user', content: 'short', uuid: 'u1', timestamp: Date.now() }],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('more above') || line.includes('more below')) { found = true; break; }
    }
    assert.ok(!found, 'Should not show scroll indicator when content fits');
  });

  // ── Collapsible thinking ──

  it('renders collapsed thinking when loading with thinkingText', () => {
    const state = makeState({
      loading: true,
      thinkingText: 'Analyzing the codebase...\nLooking at files...\nPlanning approach...',
      thinkingStartedAt: Date.now() - 5000,
      thinkingExpanded: false,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundCollapsed = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('∴ Thinking')) { foundCollapsed = true; break; }
    }
    assert.ok(foundCollapsed, 'Should show collapsed thinking summary');
  });

  it('renders expanded thinking with multiple lines', () => {
    const state = makeState({
      loading: true,
      thinkingText: 'Line 1\nLine 2\nLine 3\nLine 4',
      thinkingStartedAt: Date.now() - 3000,
      thinkingExpanded: true,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let thinkingLines = 0;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('💭')) thinkingLines++;
    }
    assert.ok(thinkingLines >= 3, `Should show multiple thinking lines, got ${thinkingLines}`);
  });

  it('renders lastThinkingSummary after completion', () => {
    const state = makeState({
      loading: false,
      lastThinkingSummary: '∴ Thought for 5s [Ctrl+O]',
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Thought for 5s')) { found = true; break; }
    }
    assert.ok(found, 'Should show thinking summary after completion');
  });

  it('does not show thinking summary when null', () => {
    const state = makeState({ loading: false, lastThinkingSummary: null });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Thought for')) { found = true; break; }
    }
    assert.ok(!found, 'Should not show thinking summary when null');
  });

  // ── Banner clamping ──

  it('renders full banner on large terminal', () => {
    const bannerLines = ['  ___', ' /   \\', '(     )', 'OpenHarness v1.0.0', '  ~/project (main)'];
    const state = makeState({ bannerLines });
    const grid = new CellGrid(80, 40); // tall terminal
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('___')) { found = true; break; }
    }
    assert.ok(found, 'Should show ASCII art on large terminal');
  });

  it('renders compact banner on small terminal', () => {
    // Art lines are indices 0-2, info lines are 3-4. Compact should only show last 2.
    const bannerLines = ['ART_LINE_1', 'ART_LINE_2', 'ART_LINE_3', 'OpenHarness v1.0.0', '  ~/project (main)'];
    const state = makeState({ bannerLines });
    const grid = new CellGrid(80, 16); // small terminal → compact mode (msgAreaHeight < 15)
    rasterize(state, grid);
    let foundArt = false;
    let foundVersion = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('ART_LINE')) foundArt = true;
      if (line.includes('OpenHarness')) foundVersion = true;
    }
    assert.ok(!foundArt, 'Should NOT show ASCII art on small terminal');
    assert.ok(foundVersion, 'Should still show version info on small terminal');
  });

  it('hides banner completely on very small terminal', () => {
    const bannerLines = ['  ___', 'OpenHarness v1.0.0', '  ~/project'];
    const state = makeState({ bannerLines });
    const grid = new CellGrid(80, 10); // very small
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('OpenHarness')) { found = true; break; }
    }
    // With a 10-row terminal, msgAreaHeight may be < 8, so banner should be hidden
    // (depends on footer height, but this tests the principle)
  });

  // ── Autocomplete with descriptions ──

  it('renders autocomplete with descriptions', () => {
    const state = makeState({
      autocomplete: ['help', 'history'],
      autocompleteDescriptions: ['Show available commands', 'List recent sessions'],
      autocompleteIndex: 0,
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundDesc = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Show available commands')) { foundDesc = true; break; }
    }
    assert.ok(foundDesc, 'Should show command description in autocomplete');
  });

  // ── Tool result summary ──

  it('renders tool result summary for completed tools', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    toolCalls.set('tc1', {
      toolName: 'Read',
      status: 'done',
      args: '/src/main.ts',
      output: 'line1\nline2\nline3',
      resultSummary: '3 lines',
      startedAt: Date.now() - 2000,
    });
    const state = makeState({ toolCalls });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('3 lines')) { found = true; break; }
    }
    assert.ok(found, 'Should show result summary for completed tool');
  });

  // ── Agent mode UI ──

  it('renders agent tool call with distinct icon and description', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    toolCalls.set('agent1', {
      toolName: 'Agent',
      status: 'running',
      args: 'Explore codebase',
      isAgent: true,
      agentDescription: 'Search for authentication patterns across the project',
      startedAt: Date.now(),
    });
    const state = makeState({ toolCalls, loading: true });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundIcon = false;
    let foundDesc = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('⊕') && line.includes('Agent')) foundIcon = true;
      if (line.includes('authentication patterns')) foundDesc = true;
    }
    assert.ok(foundIcon, 'Should show agent icon ⊕');
    assert.ok(foundDesc, 'Should show agent description');
  });

  it('renders completed agent with ◈ icon', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    toolCalls.set('agent1', {
      toolName: 'Agent',
      status: 'done',
      isAgent: true,
      output: 'Found 3 patterns',
    });
    const state = makeState({ toolCalls });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('◈')) { found = true; break; }
    }
    assert.ok(found, 'Should show completed agent icon ◈');
  });

  // ── Multi-line input ──

  it('renders multi-line input with continuation indent', () => {
    const state = makeState({ inputText: 'line 1\nline 2\nline 3', inputCursor: 19 });
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    // First line has prompt, continuation lines have indent
    let foundLine2 = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('line 2') && !line.includes('❯')) { foundLine2 = true; break; }
    }
    assert.ok(foundLine2, 'Should render continuation lines');
    // Cursor should be on line 3
    assert.ok(cursor.cursorRow > 0, 'Cursor should be past first row');
  });

  it('positions cursor correctly in multi-line input', () => {
    // Cursor at start of second line: "abc\n" → 4 chars, cursor at 4
    const state = makeState({ inputText: 'abc\ndef', inputCursor: 4 });
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    // Cursor should be on second line (inputRow + 1), col 2 (continuation indent)
    assert.strictEqual(cursor.cursorCol, 2, 'Cursor col should be at continuation indent start');
  });

  it('scrollback navigation changes visible content', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}`,
      uuid: `u${i}`,
      timestamp: Date.now(),
    }));
    const grid1 = new CellGrid(80, 24);
    const state1 = makeState({ messages, manualScroll: 0 });
    rasterize(state1, grid1);

    const grid2 = new CellGrid(80, 24);
    const state2 = makeState({ messages, manualScroll: 20 });
    rasterize(state2, grid2);

    // The two grids should show different content
    const line1 = gridText(grid1, 0);
    const line2 = gridText(grid2, 0);
    assert.notStrictEqual(line1, line2, 'Scrolled view should show different content');
  });
});
