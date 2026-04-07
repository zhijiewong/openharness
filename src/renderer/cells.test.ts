import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CellGrid, EMPTY_STYLE, cellsEqual } from './cells.js';

describe('CellGrid', () => {
  it('initializes with spaces', () => {
    const grid = new CellGrid(10, 5);
    assert.strictEqual(grid.width, 10);
    assert.strictEqual(grid.height, 5);
    assert.strictEqual(grid.cells[0]![0]!.char, ' ');
  });

  it('setCell writes a character with style', () => {
    const grid = new CellGrid(10, 5);
    grid.setCell(0, 0, 'A', { fg: 'red', bg: null, bold: true, dim: false, underline: false });
    assert.strictEqual(grid.cells[0]![0]!.char, 'A');
    assert.strictEqual(grid.cells[0]![0]!.style.fg, 'red');
    assert.strictEqual(grid.cells[0]![0]!.style.bold, true);
  });

  it('setCell ignores out-of-bounds', () => {
    const grid = new CellGrid(5, 5);
    grid.setCell(-1, 0, 'X', EMPTY_STYLE);
    grid.setCell(0, 10, 'X', EMPTY_STYLE);
    // Should not throw
    assert.strictEqual(grid.cells[0]![0]!.char, ' ');
  });

  it('writeText handles newlines', () => {
    const grid = new CellGrid(20, 5);
    const rows = grid.writeText(0, 0, 'ab\ncd', EMPTY_STYLE);
    assert.strictEqual(rows, 2);
    assert.strictEqual(grid.cells[0]![0]!.char, 'a');
    assert.strictEqual(grid.cells[1]![0]!.char, 'c');
  });

  it('writeWrapped wraps long words', () => {
    const grid = new CellGrid(10, 5);
    const rows = grid.writeWrapped(0, 0, 'hello world foo', EMPTY_STYLE, 10);
    assert.ok(rows >= 2, `expected >= 2 rows, got ${rows}`);
  });

  it('clear resets all cells', () => {
    const grid = new CellGrid(5, 5);
    grid.setCell(0, 0, 'X', { fg: 'red', bg: null, bold: true, dim: false, underline: false });
    grid.clear();
    assert.strictEqual(grid.cells[0]![0]!.char, ' ');
  });

  it('clone produces an independent copy', () => {
    const grid = new CellGrid(5, 5);
    grid.setCell(0, 0, 'A', EMPTY_STYLE);
    const clone = grid.clone();
    clone.setCell(0, 0, 'B', EMPTY_STYLE);
    assert.strictEqual(grid.cells[0]![0]!.char, 'A');
    assert.strictEqual(clone.cells[0]![0]!.char, 'B');
  });
});

describe('cellsEqual', () => {
  it('returns true for identical cells', () => {
    const a = { char: 'A', style: { ...EMPTY_STYLE } };
    const b = { char: 'A', style: { ...EMPTY_STYLE } };
    assert.strictEqual(cellsEqual(a, b), true);
  });

  it('returns false for different chars', () => {
    const a = { char: 'A', style: { ...EMPTY_STYLE } };
    const b = { char: 'B', style: { ...EMPTY_STYLE } };
    assert.strictEqual(cellsEqual(a, b), false);
  });

  it('returns false for different underline', () => {
    const a = { char: 'A', style: { ...EMPTY_STYLE, underline: false } };
    const b = { char: 'A', style: { ...EMPTY_STYLE, underline: true } };
    assert.strictEqual(cellsEqual(a, b), false);
  });
});
