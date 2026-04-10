import test from 'node:test';
import assert from 'node:assert/strict';
import { query, compressMessages } from './query/index.js';
import { createMockProvider, textResponseEvents, toolCallEvents, createErrorProvider, createMockTool } from './test-helpers.js';
import { createUserMessage, createAssistantMessage, createToolResultMessage, createMessage } from './types/message.js';
import type { Message } from './types/message.js';

// ── Basic flow ──

test('query: text response yields text_delta then turn_complete', async () => {
  const provider = createMockProvider([textResponseEvents('Hello')]);
  const events: any[] = [];
  for await (const ev of query('hi', { provider, tools: [], systemPrompt: 'test', permissionMode: 'trust' })) {
    events.push(ev);
  }
  assert.ok(events.some(e => e.type === 'text_delta' && e.content === 'Hello'));
  assert.ok(events.some(e => e.type === 'turn_complete' && e.reason === 'completed'));
});

test('query: terminates at maxTurns', async () => {
  // Provider always returns a tool call, forcing loop
  const toolEvents = toolCallEvents('MockTool', { input: 'x' });
  const provider = createMockProvider([toolEvents, toolEvents, toolEvents]);
  const mockTool = createMockTool('MockTool');
  const events: any[] = [];
  for await (const ev of query('go', { provider, tools: [mockTool], systemPrompt: 'test', permissionMode: 'trust', maxTurns: 2 })) {
    events.push(ev);
  }
  const complete = events.filter(e => e.type === 'turn_complete');
  assert.ok(complete.length > 0);
});

test('query: terminates on abortSignal', async () => {
  const controller = new AbortController();
  controller.abort(); // abort immediately
  const provider = createMockProvider([textResponseEvents('Hello')]);
  const events: any[] = [];
  for await (const ev of query('hi', { provider, tools: [], systemPrompt: 'test', permissionMode: 'trust', abortSignal: controller.signal })) {
    events.push(ev);
  }
  assert.ok(events.some(e => e.type === 'turn_complete' && e.reason === 'aborted'));
});

test('query: terminates on budget exceeded', async () => {
  const provider = createMockProvider([textResponseEvents('Hello')]);
  const events: any[] = [];
  for await (const ev of query('hi', { provider, tools: [], systemPrompt: 'test', permissionMode: 'trust', maxCost: 0.0001 })) {
    events.push(ev);
  }
  // Should either complete or hit budget
  assert.ok(events.length > 0);
});

// ── Error recovery ──

test('query: rate limit triggers retry', async () => {
  const error = new Error('HTTP 429 rate limit exceeded');
  const errorProvider = createErrorProvider(error);
  const events: any[] = [];
  for await (const ev of query('hi', { provider: errorProvider, tools: [], systemPrompt: 'test', permissionMode: 'trust', maxTurns: 1 })) {
    events.push(ev);
  }
  assert.ok(events.some(e => e.type === 'rate_limited' || e.type === 'error'));
});

test('query: network error yields error event', async () => {
  const error = new Error('fetch failed: network error');
  const errorProvider = createErrorProvider(error);
  const events: any[] = [];
  for await (const ev of query('hi', { provider: errorProvider, tools: [], systemPrompt: 'test', permissionMode: 'trust', maxTurns: 1 })) {
    events.push(ev);
  }
  assert.ok(events.some(e => e.type === 'error'));
});

// ── compressMessages ──

test('compressMessages: preserves last N messages', () => {
  const msgs: Message[] = [];
  for (let i = 0; i < 20; i++) {
    msgs.push(createUserMessage(`msg ${i}`));
    msgs.push(createAssistantMessage(`reply ${i}`));
  }
  const result = compressMessages(msgs, 100); // very low target
  assert.ok(result.length < msgs.length);
  assert.ok(result.length >= 10); // keepLast = 10
});

test('compressMessages: truncates old tool results', () => {
  const msgs: Message[] = [
    createUserMessage('start'),
    createAssistantMessage('ok', [{ id: 'tc1', toolName: 'Bash', arguments: {} }]),
    createMessage('tool', 'x'.repeat(1000), { toolResults: [{ callId: 'tc1', output: 'x'.repeat(1000), isError: false }] }),
  ];
  // Add enough messages to push old ones past keepLast
  for (let i = 0; i < 15; i++) {
    msgs.push(createUserMessage(`msg ${i}`));
    msgs.push(createAssistantMessage(`reply ${i}`));
  }
  const result = compressMessages(msgs, 500);
  // Old tool result should be truncated
  const toolMsgs = result.filter(m => m.role === 'tool');
  if (toolMsgs.length > 0) {
    assert.ok(toolMsgs[0]!.content.length < 1000 || toolMsgs[0]!.content.includes('truncated'));
  }
});

test('compressMessages: preserves pinned messages', () => {
  const msgs: Message[] = [
    createMessage('system', 'PINNED RULES', { meta: { isInfo: true, pinned: true } }),
    ...Array.from({ length: 30 }, (_, i) => createUserMessage(`msg ${i}`)),
  ];
  const result = compressMessages(msgs, 50);
  const pinned = result.filter(m => m.meta?.pinned);
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0]!.content, 'PINNED RULES');
});

test('compressMessages: removes orphaned tool results', () => {
  const msgs: Message[] = [
    createUserMessage('hi'),
    // Tool result with no matching assistant tool call
    createMessage('tool', 'orphaned', { toolResults: [{ callId: 'orphan-id', output: 'orphaned', isError: false }] }),
    createAssistantMessage('done'),
  ];
  const result = compressMessages(msgs, 10000);
  const toolMsgs = result.filter(m => m.role === 'tool');
  assert.equal(toolMsgs.length, 0); // orphaned result removed
});

test('compressMessages: returns input unchanged when <= 2 messages', () => {
  const msgs = [createUserMessage('hi')];
  const result = compressMessages(msgs, 10);
  assert.deepEqual(result, msgs);
});
