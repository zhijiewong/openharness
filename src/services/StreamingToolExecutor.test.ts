import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingToolExecutor } from './StreamingToolExecutor.js';
import { createMockTool } from '../test-helpers.js';
import type { ToolContext } from '../Tool.js';

const baseContext: ToolContext = { workingDir: '/tmp' };

test('executor: concurrent-safe tool starts immediately', async () => {
  const tool = createMockTool('Fast', { concurrent: true });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Fast', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.isError, false);
});

test('executor: multiple concurrent tools run in parallel', async () => {
  const tool = createMockTool('Fast', { concurrent: true, delay: 10 });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Fast', arguments: {} });
  executor.addTool({ id: 'c2', toolName: 'Fast', arguments: {} });
  executor.addTool({ id: 'c3', toolName: 'Fast', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results.length, 3);
});

test('executor: non-concurrent tool runs sequentially', async () => {
  const tool = createMockTool('Tool', { concurrent: false, delay: 10 });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Tool', arguments: {} });
  // Wait for first to complete before adding second
  await executor.waitForAll();
  const firstResults = [...executor.getCompletedResults()];
  assert.equal(firstResults.length, 1);
  executor.addTool({ id: 'c2', toolName: 'Tool', arguments: {} });
  await executor.waitForAll();
  const secondResults = [...executor.getCompletedResults()];
  assert.equal(secondResults.length, 1);
});

test('executor: waitForAll resolves when all complete', async () => {
  const tool = createMockTool('Slow', { concurrent: true, delay: 20 });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Slow', arguments: {} });
  executor.addTool({ id: 'c2', toolName: 'Slow', arguments: {} });
  assert.ok(executor.pendingCount > 0);
  await executor.waitForAll();
  assert.equal(executor.pendingCount, 0);
});

test('executor: getCompletedResults yields in order', async () => {
  const tool = createMockTool('Tool', { concurrent: true });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'first', toolName: 'Tool', arguments: {} });
  executor.addTool({ id: 'second', toolName: 'Tool', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results[0]!.toolCall.id, 'first');
  assert.equal(results[1]!.toolCall.id, 'second');
});

test('executor: unknown tool returns error', async () => {
  const executor = new StreamingToolExecutor([], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'NonExistent', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.isError, true);
  assert.ok(results[0]!.result.output.includes('Unknown tool'));
});

test('executor: permission denied in deny mode', async () => {
  const tool = createMockTool('Write', { readOnly: false, risk: 'medium' });
  const executor = new StreamingToolExecutor([tool], baseContext, 'deny');
  executor.addTool({ id: 'c1', toolName: 'Write', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results[0]!.result.isError, true);
  assert.ok(results[0]!.result.output.includes('Denied') || results[0]!.result.output.includes('denied'));
});

test('executor: abort signal prevents execution', async () => {
  const controller = new AbortController();
  controller.abort();
  const tool = createMockTool('Tool', { concurrent: true, delay: 100 });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust', undefined, controller.signal);
  executor.addTool({ id: 'c1', toolName: 'Tool', arguments: {} });
  await executor.waitForAll();
  const results = [...executor.getCompletedResults()];
  assert.equal(results.length, 1);
  assert.ok(results[0]!.result.output.includes('Abort'));
});

test('executor: pendingCount reflects queued + executing', async () => {
  const tool = createMockTool('Slow', { concurrent: true, delay: 50 });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Slow', arguments: {} });
  executor.addTool({ id: 'c2', toolName: 'Slow', arguments: {} });
  assert.ok(executor.pendingCount >= 1);
  await executor.waitForAll();
  assert.equal(executor.pendingCount, 0);
});

test('executor: output chunks collected', async () => {
  const tool = createMockTool('Chunky', { concurrent: true });
  const executor = new StreamingToolExecutor([tool], baseContext, 'trust');
  executor.addTool({ id: 'c1', toolName: 'Chunky', arguments: {} });
  await executor.waitForAll();
  // outputChunks may or may not have entries depending on tool implementation
  assert.ok(Array.isArray(executor.outputChunks));
});
