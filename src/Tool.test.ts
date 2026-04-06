import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toolToAPIFormat, findToolByName } from './Tool.js';
import { createMockTool } from './test-helpers.js';

describe('toolToAPIFormat', () => {
  it('returns { type: "function", function: { name, description, parameters } }', () => {
    const tool = createMockTool('Bash');
    const formatted = toolToAPIFormat(tool);
    assert.equal(formatted.type, 'function');
    assert.equal(typeof formatted.function, 'object');
    assert.equal(formatted.function.name, 'Bash');
    assert.equal(typeof formatted.function.description, 'string');
    assert.ok(formatted.function.parameters !== undefined);
  });

  it('parameters has type "object"', () => {
    const tool = createMockTool('Read');
    const formatted = toolToAPIFormat(tool);
    const params = formatted.function.parameters as { type: string };
    assert.equal(params.type, 'object');
  });
});

describe('findToolByName', () => {
  const tools = [
    createMockTool('Bash'),
    createMockTool('Read'),
    createMockTool('Write'),
  ];

  it('finds existing tool', () => {
    const found = findToolByName(tools, 'Read');
    assert.ok(found);
    assert.equal(found.name, 'Read');
  });

  it('returns undefined for missing tool', () => {
    const found = findToolByName(tools, 'NonExistent');
    assert.equal(found, undefined);
  });

  it('is case-sensitive', () => {
    const found = findToolByName(tools, 'bash');
    assert.equal(found, undefined);
  });
});
