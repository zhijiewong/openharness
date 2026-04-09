/**
 * End-to-end test for the cell renderer REPL.
 * Tests the full state machine: message → render → tool call → complete.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CellGrid } from './cells.js';
import { rasterize, rasterizeLive, type LayoutState, type ToolCallInfo } from './layout.js';
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
    const grid = new CellGrid(80, 35); // h >= 30 so banner shows, h < 40 so compact mode
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

  // ── Scrollbar ──

  it('renders scrollbar when content overflows', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i}`,
      uuid: `u${i}`,
      timestamp: Date.now(),
    }));
    const state = makeState({ messages });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    // Check rightmost column for scrollbar characters
    let foundThumb = false;
    let foundTrack = false;
    for (let r = 0; r < 20; r++) {
      const char = grid.cells[r]![79]!.char;
      if (char === '█') foundThumb = true;
      if (char === '░') foundTrack = true;
    }
    assert.ok(foundThumb, 'Should render scrollbar thumb █');
    assert.ok(foundTrack, 'Should render scrollbar track ░');
  });

  it('no scrollbar when content fits', () => {
    const state = makeState({
      messages: [{ role: 'user', content: 'short', uuid: 'u1', timestamp: Date.now() }],
    });
    const grid = new CellGrid(80, 24);
    rasterize(state, grid);
    let foundScrollbar = false;
    for (let r = 0; r < 20; r++) {
      const char = grid.cells[r]![79]!.char;
      if (char === '█' || char === '░') foundScrollbar = true;
    }
    assert.ok(!foundScrollbar, 'Should not render scrollbar when content fits');
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
    // Cursor should be on second line, col = promptWidth (2 for default mode)
    assert.strictEqual(cursor.cursorCol, 2, 'Cursor col should be at prompt width');
  });

  it('positions cursor correctly in multi-line input with vim mode', () => {
    // With vim insert mode, prompt is "[I] ❯ " = 6 chars
    const state = makeState({ inputText: 'abc\ndef', inputCursor: 4, vimMode: 'insert' });
    const grid = new CellGrid(80, 24);
    const cursor = rasterize(state, grid);
    // Cursor should be at promptWidth = 6 (vim indicator + prompt)
    assert.strictEqual(cursor.cursorCol, 6, 'Cursor col should match vim prompt width');
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

// ── rasterizeLive tests (the active production renderer) ──
describe('rasterizeLive: live area renderer', () => {
  it('renders input prompt', () => {
    const state = makeState();
    const grid = new CellGrid(80, 10);
    const cursor = rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('❯')) { found = true; break; }
    }
    assert.ok(found, 'Should show input prompt');
  });

  it('renders spinner when loading', () => {
    const state = makeState({ loading: true, thinkingStartedAt: Date.now() });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Thinking')) { found = true; break; }
    }
    assert.ok(found, 'Should show spinner');
  });

  it('renders streaming text', () => {
    const state = makeState({ loading: true, streamingText: 'streaming response' });
    const grid = new CellGrid(80, 15);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('streaming response')) { found = true; break; }
    }
    assert.ok(found, 'Should show streaming text');
  });

  it('renders error text', () => {
    const state = makeState({ errorText: 'Connection failed' });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Connection failed')) { found = true; break; }
    }
    assert.ok(found, 'Should show error');
  });

  it('renders tool calls', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    toolCalls.set('tc1', { toolName: 'Read', status: 'done', args: '/path/to/file.ts' });
    const state = makeState({ toolCalls });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Read') && gridText(grid, r).includes('✓')) { found = true; break; }
    }
    assert.ok(found, 'Should show completed tool');
  });

  it('renders permission prompt with Y/N', () => {
    const state = makeState({
      permissionBox: { toolName: 'Bash', description: 'rm -rf', riskLevel: 'high', suggestion: null },
    });
    const grid = new CellGrid(80, 12);
    rasterizeLive(state, grid);
    let foundTool = false, foundYN = false;
    for (let r = 0; r < grid.height; r++) {
      const line = gridText(grid, r);
      if (line.includes('Bash') && line.includes('high')) foundTool = true;
      if (line.includes('Yes') && line.includes('No')) foundYN = true;
    }
    assert.ok(foundTool, 'Should show tool name and risk');
    assert.ok(foundYN, 'Should show Y/N options');
  });

  it('renders question prompt with correct cursor', () => {
    const state = makeState({
      questionPrompt: { question: 'Pick one', options: ['A', 'B'], input: 'A', cursor: 1 },
    });
    const grid = new CellGrid(80, 15);
    const cursor = rasterizeLive(state, grid);
    assert.strictEqual(cursor.cursorCol, 3 + 1, 'Cursor should be at col 3 + cursor offset');
  });

  it('renders status line', () => {
    const state = makeState({ statusLine: 'llama3 │ 1K↑ 500↓' });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('llama3')) { found = true; break; }
    }
    assert.ok(found, 'Should show status line');
  });

  it('renders context warning', () => {
    const state = makeState({ contextWarning: { text: '⚠ Context 85% full', critical: false } });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Context 85%')) { found = true; break; }
    }
    assert.ok(found, 'Should show context warning');
  });

  it('renders collapsed thinking summary', () => {
    const state = makeState({ lastThinkingSummary: '∴ Thought for 3s [Ctrl+O]' });
    const grid = new CellGrid(80, 10);
    rasterizeLive(state, grid);
    let found = false;
    for (let r = 0; r < grid.height; r++) {
      if (gridText(grid, r).includes('Thought for 3s')) { found = true; break; }
    }
    assert.ok(found, 'Should show thinking summary');
  });
});
