import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getRole, listRoles, getRoleIds } from './roles.js';

describe('agent roles', () => {
  it('lists all roles', () => {
    const roles = listRoles();
    assert.ok(roles.length >= 6);
    assert.ok(roles.find(r => r.id === 'code-reviewer'));
    assert.ok(roles.find(r => r.id === 'test-writer'));
    assert.ok(roles.find(r => r.id === 'debugger'));
    assert.ok(roles.find(r => r.id === 'security-auditor'));
  });

  it('gets role by ID', () => {
    const role = getRole('code-reviewer');
    assert.ok(role);
    assert.strictEqual(role.name, 'Code Reviewer');
    assert.ok(role.systemPromptSupplement.length > 50);
    assert.ok(role.suggestedTools!.includes('FileRead'));
  });

  it('returns undefined for unknown role', () => {
    assert.strictEqual(getRole('nonexistent'), undefined);
  });

  it('getRoleIds returns all IDs', () => {
    const ids = getRoleIds();
    assert.ok(ids.includes('code-reviewer'));
    assert.ok(ids.includes('test-writer'));
    assert.ok(ids.includes('refactorer'));
  });

  it('every role has required fields', () => {
    for (const role of listRoles()) {
      assert.ok(role.id, `role missing id`);
      assert.ok(role.name, `role ${role.id} missing name`);
      assert.ok(role.description, `role ${role.id} missing description`);
      assert.ok(role.systemPromptSupplement.length > 20, `role ${role.id} has short prompt`);
    }
  });
});
