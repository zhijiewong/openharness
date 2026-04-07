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
    manualScroll: 0,
    codeBlocksExpanded: false,
    sessionBrowser: null,
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
      if (line.includes('[Y]es') && line.includes('[N]o')) foundYN = true;
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
