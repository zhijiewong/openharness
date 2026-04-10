/**
 * Tests for diff rendering — extractDiffInfo, prepareDiff, renderDiff.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CellGrid } from './cells.js';
import { extractDiffInfo, prepareDiff, renderDiff, resetDiffStyleCache, type DiffInfo } from './diff.js';
import { setActiveTheme } from '../utils/theme-data.js';

setActiveTheme('dark');
resetDiffStyleCache();

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'oh-diff-test-'));
}

function gridText(grid: CellGrid, row: number): string {
  return grid.cells[row]!.map(c => c.char).join('').trimEnd();
}

// ── extractDiffInfo ──

describe('extractDiffInfo', () => {
  it('returns null for non-file tools', () => {
    assert.equal(extractDiffInfo('Bash', '{"command":"echo hi"}'), null);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(extractDiffInfo('Write', 'not json'), null);
  });

  it('extracts write diff for new file', () => {
    const dir = tmp();
    const fp = join(dir, 'new.txt');
    const info = extractDiffInfo('Write', JSON.stringify({ file_path: fp, content: 'hello\nworld' }));
    assert.ok(info !== null);
    assert.equal(info!.oldContent, '');
    assert.equal(info!.newContent, 'hello\nworld');
    assert.equal(info!.filePath, fp);
  });

  it('extracts write diff for existing file', () => {
    const dir = tmp();
    const fp = join(dir, 'existing.txt');
    writeFileSync(fp, 'old content');
    const info = extractDiffInfo('Write', JSON.stringify({ file_path: fp, content: 'new content' }));
    assert.ok(info !== null);
    assert.equal(info!.oldContent, 'old content');
    assert.equal(info!.newContent, 'new content');
  });

  it('extracts edit diff with old_string/new_string', () => {
    const dir = tmp();
    const fp = join(dir, 'edit.txt');
    writeFileSync(fp, 'const x = 1;\nconst y = 2;');
    const info = extractDiffInfo('Edit', JSON.stringify({
      file_path: fp,
      old_string: 'const x = 1;',
      new_string: 'const x = 42;',
    }));
    assert.ok(info !== null);
    assert.ok(info!.newContent.includes('const x = 42;'));
    assert.equal(info!.oldString, 'const x = 1;');
    assert.equal(info!.newString, 'const x = 42;');
  });

  it('returns null for edit on nonexistent file', () => {
    const info = extractDiffInfo('Edit', JSON.stringify({
      file_path: '/nonexistent/path.txt',
      old_string: 'x',
      new_string: 'y',
    }));
    assert.equal(info, null);
  });
});

// ── prepareDiff ──

describe('prepareDiff', () => {
  it('caches diff display and stats', () => {
    const info: DiffInfo = {
      filePath: 'test.ts',
      oldContent: 'line1\nline2\nline3',
      newContent: 'line1\nmodified\nline3\nline4',
    };
    prepareDiff(info);
    assert.ok(info.cachedDisplay !== undefined);
    assert.ok(info.cachedAdds !== undefined);
    assert.ok(info.cachedRemoves !== undefined);
    assert.ok(info.cachedAdds! > 0);
  });

  it('does not recompute if already cached', () => {
    const info: DiffInfo = {
      filePath: 'test.ts',
      oldContent: 'a',
      newContent: 'b',
      cachedDisplay: [{ type: 'add', line: 'b' }],
      cachedAdds: 1,
      cachedRemoves: 1,
    };
    prepareDiff(info);
    // Should still be the original cached values
    assert.equal(info.cachedDisplay!.length, 1);
  });

  it('respects maxLines', () => {
    const old = Array.from({ length: 50 }, (_, i) => `old${i}`).join('\n');
    const nu = Array.from({ length: 50 }, (_, i) => `new${i}`).join('\n');
    const info: DiffInfo = { filePath: 'big.ts', oldContent: old, newContent: nu };
    prepareDiff(info, 10);
    assert.ok(info.cachedDisplay!.length <= 10);
  });
});

// ── renderDiff ──

describe('renderDiff', () => {
  it('renders file header and stats', () => {
    const info: DiffInfo = {
      filePath: 'src/app.ts',
      oldContent: 'old line',
      newContent: 'new line',
    };
    const grid = new CellGrid(80, 20);
    const rows = renderDiff(grid, 0, 0, info, 80);
    assert.ok(rows > 0, 'Should consume rows');
    assert.ok(gridText(grid, 0).includes('src/app.ts'), 'File path not in header');
    // Stats line
    assert.ok(gridText(grid, 1).includes('+'), 'Add count not shown');
    assert.ok(gridText(grid, 1).includes('-'), 'Remove count not shown');
  });

  it('renders add/remove lines with prefixes', () => {
    const info: DiffInfo = {
      filePath: 'test.js',
      oldContent: 'const x = 1;',
      newContent: 'const x = 2;',
    };
    const grid = new CellGrid(80, 20);
    renderDiff(grid, 0, 0, info, 80);
    let hasAdd = false, hasRemove = false;
    for (let r = 0; r < 20; r++) {
      const text = gridText(grid, r);
      if (text.startsWith('+ ')) hasAdd = true;
      if (text.startsWith('- ')) hasRemove = true;
    }
    assert.ok(hasAdd, 'No add line found');
    assert.ok(hasRemove, 'No remove line found');
  });
});
