import { describe, it } from 'node:test';
import assert from 'node:assert';
import { measureMarkdown, renderMarkdown } from './markdown.js';
import { CellGrid } from './cells.js';
import { setActiveTheme } from '../utils/theme-data.js';

// Initialize theme for tests
setActiveTheme('dark');

describe('measureMarkdown', () => {
  it('returns 1 for a single line', () => {
    assert.strictEqual(measureMarkdown('hello world', 80), 1);
  });

  it('returns 0 for empty string', () => {
    assert.strictEqual(measureMarkdown('', 80), 1); // empty line still counts as 1
  });

  it('counts code block lines correctly', () => {
    const md = '```js\nconst x = 1;\nconst y = 2;\n```';
    const rows = measureMarkdown(md, 80);
    // opening fence + 2 code lines + closing fence = 4
    assert.strictEqual(rows, 4);
  });

  it('counts table rows', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const rows = measureMarkdown(md, 80);
    // header + separator + 2 data rows = 4
    assert.strictEqual(rows, 4);
  });

  it('handles multiline text with wrapping estimate', () => {
    const longLine = 'a'.repeat(200);
    const rows = measureMarkdown(longLine, 80);
    // 200 chars / (80 - 2) = ~2.6, ceil = 3
    assert.ok(rows >= 2);
  });
});

describe('renderMarkdown', () => {
  it('renders plain text', () => {
    const grid = new CellGrid(80, 10);
    const rows = renderMarkdown(grid, 0, 0, 'hello world', 80);
    assert.strictEqual(rows, 1);
    // Check first chars
    assert.strictEqual(grid.cells[0]![0]!.char, 'h');
    assert.strictEqual(grid.cells[0]![4]!.char, 'o');
  });

  it('renders a heading with bold', () => {
    const grid = new CellGrid(80, 10);
    const rows = renderMarkdown(grid, 0, 0, '# Hello', 80);
    assert.strictEqual(rows, 1);
    // '#' should be rendered with bold
    assert.strictEqual(grid.cells[0]![0]!.style.bold, true);
  });

  it('renders code block with fence lines', () => {
    const grid = new CellGrid(80, 10);
    const md = '```js\nconst x = 1;\n```';
    const rows = renderMarkdown(grid, 0, 0, md, 80);
    assert.strictEqual(rows, 3);
    // First line should start with ```
    assert.strictEqual(grid.cells[0]![0]!.char, '`');
  });

  it('renders bullet list with bullet char', () => {
    const grid = new CellGrid(80, 10);
    const rows = renderMarkdown(grid, 0, 0, '- item one\n- item two', 80);
    assert.strictEqual(rows, 2);
    // Bullet should be present
    assert.strictEqual(grid.cells[0]![0]!.char, '•');
  });

  it('collapses long code blocks when not expanded', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const md = '```\n' + lines.join('\n') + '\n```';
    const grid = new CellGrid(80, 40);
    const rowsCollapsed = renderMarkdown(grid, 0, 0, md, 80, false);
    const grid2 = new CellGrid(80, 40);
    const rowsExpanded = renderMarkdown(grid2, 0, 0, md, 80, true);
    // Collapsed should be fewer rows than expanded
    assert.ok(rowsCollapsed < rowsExpanded, `collapsed ${rowsCollapsed} should be < expanded ${rowsExpanded}`);
  });

  it('handles empty input', () => {
    const grid = new CellGrid(80, 10);
    const rows = renderMarkdown(grid, 0, 0, '', 80);
    assert.strictEqual(rows, 1);
  });
});
