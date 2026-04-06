import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { McpTool } from './McpTool.js';
import type { McpToolDef } from './types.js';

function createMockClient(overrides: Partial<{ callTool: (name: string, args: Record<string, unknown>) => Promise<string> }> = {}) {
  return {
    name: 'test-server',
    callTool: overrides.callTool ?? (async (_name: string, _args: Record<string, unknown>) => 'result text'),
  } as any;
}

function baseDef(name = 'myTool', description?: string): McpToolDef {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  };
}

describe('McpTool', () => {
  it('constructor sets name as serverName__toolName', () => {
    const tool = new McpTool(createMockClient(), baseDef('searchDocs'));
    assert.equal(tool.name, 'test-server__searchDocs');
  });

  it('description uses def.description when provided', () => {
    const tool = new McpTool(createMockClient(), baseDef('t', 'Search the docs'));
    assert.equal(tool.description, 'Search the docs');
  });

  it('riskLevel defaults to medium', () => {
    const tool = new McpTool(createMockClient(), baseDef());
    assert.equal(tool.riskLevel, 'medium');
  });

  it('call() delegates to client.callTool and returns output', async () => {
    const client = createMockClient({
      callTool: async (name, args) => `called ${name} with ${JSON.stringify(args)}`,
    });
    const tool = new McpTool(client, baseDef('echo'));
    const result = await tool.call({ query: 'hello' }, { workingDir: '.' });
    assert.equal(result.isError, false);
    assert.equal(result.output, 'called echo with {"query":"hello"}');
  });

  it('call() catches errors and returns isError=true', async () => {
    const client = createMockClient({
      callTool: async () => { throw new Error('server crashed'); },
    });
    const tool = new McpTool(client, baseDef('fail'));
    const result = await tool.call({}, { workingDir: '.' });
    assert.equal(result.isError, true);
    assert.ok(result.output.includes('server crashed'));
  });
});
