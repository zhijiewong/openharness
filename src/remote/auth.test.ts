import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, validateToken, generateRequestId } from './auth.js';

describe('API auth', () => {
  describe('checkRateLimit', () => {
    it('allows first request', () => {
      assert.equal(checkRateLimit('test-ip-1', 10), true);
    });

    it('allows requests within limit', () => {
      const ip = 'test-ip-2-' + Date.now();
      for (let i = 0; i < 5; i++) {
        assert.equal(checkRateLimit(ip, 10), true);
      }
    });

    it('blocks requests exceeding limit', () => {
      const ip = 'test-ip-3-' + Date.now();
      for (let i = 0; i < 3; i++) {
        checkRateLimit(ip, 3);
      }
      assert.equal(checkRateLimit(ip, 3), false);
    });

    it('different IPs have independent limits', () => {
      const ip1 = 'ip-a-' + Date.now();
      const ip2 = 'ip-b-' + Date.now();
      for (let i = 0; i < 3; i++) checkRateLimit(ip1, 3);
      assert.equal(checkRateLimit(ip1, 3), false);
      assert.equal(checkRateLimit(ip2, 3), true);
    });
  });

  describe('validateToken', () => {
    it('allows requests when no tokens configured', () => {
      // Default config has no remote.tokens
      assert.equal(validateToken(undefined), true);
      assert.equal(validateToken('Bearer anything'), true);
    });
  });

  describe('generateRequestId', () => {
    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(generateRequestId());
      }
      assert.equal(ids.size, 50);
    });

    it('starts with req-', () => {
      assert.ok(generateRequestId().startsWith('req-'));
    });
  });
});
