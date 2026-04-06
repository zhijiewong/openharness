import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitHook, emitHookAsync } from './hooks.js';

describe('emitHook', () => {
  it('returns true when no hooks configured (default)', () => {
    // cachedHooks starts undefined; getHooks() reads config which returns null
    // when no .oh/config file exists, so emitHook returns true.
    const result = emitHook('sessionStart');
    assert.equal(result, true);
  });

  it('emitHook("sessionStart") returns true', () => {
    assert.equal(emitHook('sessionStart'), true);
  });

  it('emitHook("sessionEnd") returns true', () => {
    assert.equal(emitHook('sessionEnd'), true);
  });
});

describe('emitHookAsync', () => {
  it('returns true when no hooks configured', async () => {
    const result = await emitHookAsync('sessionStart');
    assert.equal(result, true);
  });
});
