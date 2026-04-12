import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isPathAllowed, isDomainAllowed, isCommandAllowed, sandboxStatus, invalidateSandboxCache } from './sandbox.js';

describe('sandbox', () => {
  beforeEach(() => {
    invalidateSandboxCache();
  });

  describe('isPathAllowed', () => {
    it('allows all paths when sandbox disabled', () => {
      assert.equal(isPathAllowed('/etc/passwd'), true);
      assert.equal(isPathAllowed('/tmp/anything'), true);
    });
  });

  describe('isDomainAllowed', () => {
    it('allows all domains when sandbox disabled', () => {
      assert.equal(isDomainAllowed('https://example.com'), true);
      assert.equal(isDomainAllowed('https://evil.com'), true);
    });

    it('handles invalid URLs gracefully', () => {
      // When sandbox is disabled, all URLs are allowed
      assert.equal(isDomainAllowed('not-a-url'), true);
    });
  });

  describe('isCommandAllowed', () => {
    it('allows all commands when sandbox disabled', () => {
      assert.equal(isCommandAllowed('curl https://evil.com'), true);
      assert.equal(isCommandAllowed('rm -rf /'), true);
    });
  });

  describe('sandboxStatus', () => {
    it('shows disabled when no config', () => {
      const status = sandboxStatus();
      assert.ok(status.includes('disabled'));
    });
  });
});
