import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CellGrid } from './cells.js';
import { rasterize, type LayoutState, type ToolCallInfo } from './layout.js';
import { measureMarkdown, renderMarkdown } from './markdown.js';
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
    statusLine: 'model | 1.2K↑ 500↓ | $0.01',
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
    ...overrides,
  };
}

describe('rasterize performance', () => {
  it('renders 100 messages in under 50ms', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${i}: ${'lorem ipsum dolor sit amet '.repeat(5)}`,
      uuid: `msg-${i}`,
      timestamp: Date.now(),
    }));
    const state = makeState({ messages });
    const grid = new CellGrid(120, 40);

    const start = performance.now();
    for (let frame = 0; frame < 10; frame++) {
      grid.clear();
      rasterize(state, grid);
    }
    const elapsed = performance.now() - start;
    const perFrame = elapsed / 10;

    console.log(`  rasterize 100 msgs: ${perFrame.toFixed(2)}ms/frame`);
    assert.ok(perFrame < 50, `Expected < 50ms/frame, got ${perFrame.toFixed(2)}ms`);
  });

  it('renders messages with markdown in under 100ms', () => {
    const mdContent = `# Heading\n\nSome text with **bold** and \`code\`.\n\n\`\`\`typescript\nconst x = 1;\nconst y = "hello";\nfunction foo() {\n  return x + y;\n}\n\`\`\`\n\n- item one\n- item two\n- item three\n`;
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: i % 2 === 1 ? mdContent : `Question ${i}`,
      uuid: `msg-${i}`,
      timestamp: Date.now(),
    }));
    const state = makeState({ messages });
    const grid = new CellGrid(120, 40);

    const start = performance.now();
    for (let frame = 0; frame < 10; frame++) {
      grid.clear();
      rasterize(state, grid);
    }
    const elapsed = performance.now() - start;
    const perFrame = elapsed / 10;

    console.log(`  rasterize 50 md msgs: ${perFrame.toFixed(2)}ms/frame`);
    assert.ok(perFrame < 100, `Expected < 100ms/frame, got ${perFrame.toFixed(2)}ms`);
  });

  it('measureMarkdown is consistent with renderMarkdown row count', () => {
    const testCases = [
      'hello world',
      '# Heading\nParagraph text.',
      '```js\nconst x = 1;\n```',
      '- one\n- two\n- three',
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
      '> blockquote\n\n---\n\nMore text.',
    ];

    for (const md of testCases) {
      const measured = measureMarkdown(md, 80);
      const grid = new CellGrid(80, 100);
      const rendered = renderMarkdown(grid, 0, 0, md, 80, true);
      // Allow ±2 row difference due to measurement approximations
      const diff = Math.abs(measured - rendered);
      assert.ok(diff <= 2, `Mismatch for "${md.slice(0, 30)}...": measured=${measured}, rendered=${rendered}`);
    }
  });

  it('rasterize with tool calls stays under 20ms', () => {
    const toolCalls = new Map<string, ToolCallInfo>();
    for (let i = 0; i < 10; i++) {
      toolCalls.set(`tc-${i}`, {
        toolName: `Tool${i}`,
        status: i < 5 ? 'done' : 'running',
        args: `/path/to/file${i}.ts`,
        output: `Output line 1\nOutput line 2\nOutput line 3`,
        liveOutput: i >= 5 ? ['live line 1', 'live line 2'] : undefined,
      });
    }
    const state = makeState({ toolCalls, loading: true, thinkingStartedAt: Date.now() });
    const grid = new CellGrid(120, 40);

    const start = performance.now();
    for (let frame = 0; frame < 20; frame++) {
      state.spinnerFrame = frame;
      grid.clear();
      rasterize(state, grid);
    }
    const elapsed = performance.now() - start;
    const perFrame = elapsed / 20;

    console.log(`  rasterize 10 tool calls: ${perFrame.toFixed(2)}ms/frame`);
    assert.ok(perFrame < 20, `Expected < 20ms/frame, got ${perFrame.toFixed(2)}ms`);
  });
});
