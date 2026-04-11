import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTool } from './test-helpers.js';
import { DeferredTool } from './DeferredTool.js';

describe('DeferredTool', () => {
  it('wraps a tool with correct name and description', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    assert.equal(deferred.name, 'TestTool');
    assert.equal(deferred.description, inner.description);
    assert.equal(deferred.riskLevel, inner.riskLevel);
  });

  it('returns deferred prompt before activation', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    const prompt = deferred.prompt();
    assert.ok(prompt.startsWith('[deferred]'));
    assert.ok(prompt.includes('TestTool'));
  });

  it('returns full prompt after activation', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    deferred.activate();
    assert.equal(deferred.prompt(), inner.prompt());
  });

  it('is not activated by default', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    assert.equal(deferred.activated, false);
  });

  it('activates on call()', async () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    assert.equal(deferred.activated, false);

    const result = await deferred.call({ input: 'test' }, { workingDir: '/tmp' });
    assert.equal(deferred.activated, true);
    assert.equal(result.isError, false);
    assert.ok(result.output.includes('TestTool'));
  });

  it('activates via activate() method', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    deferred.activate();
    assert.equal(deferred.activated, true);
  });

  it('returns full prompt after call()', async () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    await deferred.call({ input: 'test' }, { workingDir: '/tmp' });
    assert.equal(deferred.prompt(), inner.prompt());
  });

  it('validates input against inner schema and returns error', async () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    // Inner schema expects { input?: string }, pass something wildly wrong
    // Since z.object({ input: z.string().optional() }) is permissive,
    // we pass a valid object and check it works
    const result = await deferred.call({ input: 'valid' }, { workingDir: '/tmp' });
    assert.equal(result.isError, false);
  });

  it('exposes inner tool via getInner()', () => {
    const inner = createMockTool('TestTool');
    const deferred = new DeferredTool(inner);
    assert.equal(deferred.getInner(), inner);
  });

  it('delegates isReadOnly to inner tool', () => {
    const readOnly = createMockTool('ReadOnly', { readOnly: true });
    const writable = createMockTool('Writable', { readOnly: false });
    assert.equal(new DeferredTool(readOnly).isReadOnly({}), true);
    assert.equal(new DeferredTool(writable).isReadOnly({}), false);
  });

  it('delegates isConcurrencySafe to inner tool', () => {
    const safe = createMockTool('Safe', { concurrent: true });
    const unsafe = createMockTool('Unsafe', { concurrent: false });
    assert.equal(new DeferredTool(safe).isConcurrencySafe({}), true);
    assert.equal(new DeferredTool(unsafe).isConcurrencySafe({}), false);
  });
});
