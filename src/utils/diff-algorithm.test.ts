import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeDiff, filterWithContext } from './diff-algorithm.js';

describe('computeDiff', () => {
  it('returns empty for identical strings', () => {
    const diff = computeDiff('hello', 'hello');
    assert.strictEqual(diff.length, 1);
    assert.strictEqual(diff[0]!.type, 'context');
  });

  it('detects added lines', () => {
    const diff = computeDiff('a\nb', 'a\nb\nc');
    const adds = diff.filter(d => d.type === 'add');
    assert.strictEqual(adds.length, 1);
    assert.strictEqual(adds[0]!.line, 'c');
  });

  it('detects removed lines', () => {
    const diff = computeDiff('a\nb\nc', 'a\nc');
    const removes = diff.filter(d => d.type === 'remove');
    assert.strictEqual(removes.length, 1);
    assert.strictEqual(removes[0]!.line, 'b');
  });

  it('handles empty old text', () => {
    const diff = computeDiff('', 'new content');
    assert.ok(diff.some(d => d.type === 'add'));
  });

  it('handles empty new text', () => {
    const diff = computeDiff('old content', '');
    assert.ok(diff.some(d => d.type === 'remove'));
  });
});

describe('filterWithContext', () => {
  it('shows context around changes', () => {
    const diff = computeDiff('a\nb\nc\nd\ne\nf\ng', 'a\nb\nX\nd\ne\nf\ng');
    const filtered = filterWithContext(diff, 1);
    // Should show b (context), remove c, add X, d (context)
    assert.ok(filtered.length < diff.length);
    assert.ok(filtered.some(d => d.line === 'X' && d.type === 'add'));
  });

  it('adds separator between distant changes', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const lines = old.split('\n');
    lines[2] = 'CHANGED2';
    lines[18] = 'CHANGED18';
    const diff = computeDiff(old, lines.join('\n'));
    const filtered = filterWithContext(diff, 1);
    assert.ok(filtered.some(d => d.type === 'separator'));
  });
});
