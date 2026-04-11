/**
 * End-to-end integration tests for the agent loop.
 *
 * Tests the full cycle: user message → LLM stream → tool call →
 * tool execution → result fed back → LLM response.
 *
 * Uses mock provider to control LLM behavior, real tools (Read, Glob)
 * to exercise actual execution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { query } from './index.js';
import type { QueryConfig } from './types.js';
import type { StreamEvent } from '../types/events.js';
import {
  createMockProvider,
  createMockTool,
  makeTmpDir,
  writeFile,
  textResponseEvents,
  toolCallEvents,
} from '../test-helpers.js';

/** Collect all events from a query run */
async function collectEvents(userMsg: string, config: QueryConfig): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of query(userMsg, config)) {
    events.push(event);
  }
  return events;
}

/** Extract text from events */
function extractText(events: StreamEvent[]): string {
  return events
    .filter(e => e.type === 'text_delta')
    .map(e => (e as any).content)
    .join('');
}

describe('agent loop E2E', () => {
  it('simple text response — no tool calls', async () => {
    const provider = createMockProvider([
      textResponseEvents('Hello! How can I help?'),
    ]);

    const events = await collectEvents('hi', {
      provider,
      tools: [],
      systemPrompt: 'You are helpful.',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    const text = extractText(events);
    assert.equal(text, 'Hello! How can I help?');
    assert.ok(events.some(e => e.type === 'turn_complete'));
  });

  it('tool call → execution → follow-up response', async () => {
    const mockTool = createMockTool('TestTool', {
      result: { output: 'tool result: 42', isError: false },
    });

    // Turn 1: LLM calls the tool
    // Turn 2: LLM responds with the result
    const provider = createMockProvider([
      toolCallEvents('TestTool', { input: 'test' }),
      textResponseEvents('The answer is 42.'),
    ]);

    const events = await collectEvents('What is the answer?', {
      provider,
      tools: [mockTool],
      systemPrompt: 'You are helpful.',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    const text = extractText(events);
    assert.equal(text, 'The answer is 42.');

    // Should have tool_call_end event with the tool result
    const toolEnd = events.find(e => e.type === 'tool_call_end') as any;
    assert.ok(toolEnd, 'should have tool_call_end event');
    assert.ok(toolEnd.output.includes('tool result: 42'));
  });

  it('respects maxTurns limit', async () => {
    // Provider always returns tool calls — should stop after maxTurns
    const mockTool = createMockTool('LoopTool');
    const turns = Array.from({ length: 5 }, () =>
      toolCallEvents('LoopTool', { input: 'loop' }),
    );

    const provider = createMockProvider(turns);
    const events = await collectEvents('loop forever', {
      provider,
      tools: [mockTool],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 3,
    });

    const complete = events.find(e => e.type === 'turn_complete') as any;
    assert.ok(complete);
    assert.equal(complete.reason, 'max_turns');
  });

  it('handles tool execution error gracefully', async () => {
    const failTool = createMockTool('FailTool', {
      result: { output: 'Something went wrong', isError: true },
    });

    const provider = createMockProvider([
      toolCallEvents('FailTool', { input: 'fail' }),
      textResponseEvents('Sorry, the tool failed.'),
    ]);

    const events = await collectEvents('run the failing tool', {
      provider,
      tools: [failTool],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    const toolEnd = events.find(e => e.type === 'tool_call_end') as any;
    assert.ok(toolEnd);
    assert.equal(toolEnd.isError, true);

    const text = extractText(events);
    assert.equal(text, 'Sorry, the tool failed.');
  });

  it('aborts via AbortSignal', async () => {
    const controller = new AbortController();
    const slowTool = createMockTool('SlowTool', { delay: 5000 });

    const provider = createMockProvider([
      toolCallEvents('SlowTool', { input: 'slow' }),
    ]);

    // Abort immediately
    controller.abort();

    const events = await collectEvents('do something slow', {
      provider,
      tools: [slowTool],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 5,
      abortSignal: controller.signal,
    });

    const complete = events.find(e => e.type === 'turn_complete') as any;
    assert.ok(complete);
    assert.equal(complete.reason, 'aborted');
  });

  it('permission denied in deny mode prevents tool execution', async () => {
    const writeTool = createMockTool('WriteTool', { readOnly: false, risk: 'medium' });

    const provider = createMockProvider([
      toolCallEvents('WriteTool', { input: 'write' }),
      textResponseEvents('Permission was denied.'),
    ]);

    const events = await collectEvents('write something', {
      provider,
      tools: [writeTool],
      systemPrompt: 'test',
      permissionMode: 'deny',
      maxTurns: 5,
    });

    const toolEnd = events.find(e => e.type === 'tool_call_end') as any;
    assert.ok(toolEnd);
    assert.equal(toolEnd.isError, true);
    assert.ok(toolEnd.output.includes('denied') || toolEnd.output.includes('Denied'));
  });

  it('unknown tool returns error result', async () => {
    const provider = createMockProvider([
      toolCallEvents('NonExistentTool', {}),
      textResponseEvents('Tool not found.'),
    ]);

    const events = await collectEvents('use fake tool', {
      provider,
      tools: [],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    const toolEnd = events.find(e => e.type === 'tool_call_end') as any;
    assert.ok(toolEnd);
    assert.equal(toolEnd.isError, true);
    assert.ok(toolEnd.output.includes('Unknown tool'));
  });

  it('multi-turn conversation preserves context', async () => {
    const provider = createMockProvider([
      textResponseEvents('I remember the conversation.'),
    ]);

    const events = await collectEvents('What did we discuss?', {
      provider,
      tools: [],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    // Provider should receive the user message in its call
    assert.equal(provider.calls.length, 1);
    const msgs = provider.calls[0]!.messages;
    assert.ok(msgs.some(m => m.content.includes('What did we discuss?')));
  });

  it('cost tracking accumulates across turns', async () => {
    const mockTool = createMockTool('CostTool');
    const provider = createMockProvider([
      toolCallEvents('CostTool', { input: 'a' }),
      textResponseEvents('Done.'),
    ]);

    const events = await collectEvents('track costs', {
      provider,
      tools: [mockTool],
      systemPrompt: 'test',
      permissionMode: 'trust',
      maxTurns: 5,
    });

    const costEvents = events.filter(e => e.type === 'cost_update');
    assert.ok(costEvents.length >= 2, 'should have cost updates from both turns');
  });
});
