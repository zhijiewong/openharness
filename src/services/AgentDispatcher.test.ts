import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentDispatcher } from './AgentDispatcher.js';
import { createMockProvider, textResponseEvents, makeTmpDir, createMockTool } from '../test-helpers.js';

describe('AgentDispatcher', () => {
  const tools = [createMockTool('Bash')];
  const systemPrompt = 'You are a test agent.';

  it('single task executes and returns result', async () => {
    const provider = createMockProvider([textResponseEvents('done')]);
    const tmpDir = makeTmpDir();
    const dispatcher = new AgentDispatcher(provider, tools, systemPrompt, 'trust', undefined, tmpDir);
    dispatcher.addTask({ id: 'a', prompt: 'Say hello' });
    const results = await dispatcher.execute();
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, 'a');
    assert.equal(results[0]!.isError, false);
    assert.ok(results[0]!.durationMs >= 0);
  });

  it('two independent tasks both complete', async () => {
    // Each task needs its own turn of stream events
    const provider = createMockProvider([
      textResponseEvents('result-1'),
      textResponseEvents('result-2'),
    ]);
    const tmpDir = makeTmpDir();
    const dispatcher = new AgentDispatcher(provider, tools, systemPrompt, 'trust', undefined, tmpDir);
    dispatcher.addTasks([
      { id: 'x', prompt: 'Task X' },
      { id: 'y', prompt: 'Task Y' },
    ]);
    const results = await dispatcher.execute();
    assert.equal(results.length, 2);
    const ids = results.map(r => r.id).sort();
    assert.deepEqual(ids, ['x', 'y']);
  });

  it('task with blockedBy waits for blocker to complete', async () => {
    const provider = createMockProvider([
      textResponseEvents('first-done'),
      textResponseEvents('second-done'),
    ]);
    const tmpDir = makeTmpDir();
    const dispatcher = new AgentDispatcher(provider, tools, systemPrompt, 'trust', undefined, tmpDir);
    dispatcher.addTasks([
      { id: 'step1', prompt: 'Do step 1' },
      { id: 'step2', prompt: 'Do step 2', blockedBy: ['step1'] },
    ]);
    const results = await dispatcher.execute();
    assert.equal(results.length, 2);
    // step1 should complete before step2
    const step1Idx = results.findIndex(r => r.id === 'step1');
    const step2Idx = results.findIndex(r => r.id === 'step2');
    assert.ok(step1Idx < step2Idx, 'step1 should complete before step2');
  });

  it('abort signal stops execution', async () => {
    const ac = new AbortController();
    ac.abort(); // abort immediately
    const provider = createMockProvider([textResponseEvents('never')]);
    const tmpDir = makeTmpDir();
    const dispatcher = new AgentDispatcher(provider, tools, systemPrompt, 'trust', undefined, tmpDir, ac.signal);
    dispatcher.addTask({ id: 'z', prompt: 'Should not run' });
    const results = await dispatcher.execute();
    // With an already-aborted signal, the loop exits immediately
    assert.equal(results.length, 0);
  });
});
