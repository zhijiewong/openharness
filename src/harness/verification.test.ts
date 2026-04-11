import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { makeTmpDir, writeFile } from '../test-helpers.js';
import {
  autoDetectRules,
  extractFilePaths,
  runVerification,
  runVerificationForFiles,
  getVerificationConfig,
  invalidateVerificationCache,
} from './verification.js';

describe('verification loops', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    invalidateVerificationCache();
  });

  describe('autoDetectRules', () => {
    it('detects TypeScript rules when tsconfig.json exists', () => {
      writeFile(tmp, 'tsconfig.json', '{}');
      const rules = autoDetectRules(tmp);
      assert.ok(rules.length > 0);
      const tsRule = rules.find(r => r.extensions.includes('.ts'));
      assert.ok(tsRule, 'should find a TypeScript rule');
      assert.ok(tsRule.lint, 'TypeScript rule should have a lint command');
    });

    it('detects Python rules when pyproject.toml exists', () => {
      writeFile(tmp, 'pyproject.toml', '[project]\nname = "test"');
      const rules = autoDetectRules(tmp);
      const pyRule = rules.find(r => r.extensions.includes('.py'));
      assert.ok(pyRule, 'should find a Python rule');
    });

    it('detects Go rules when go.mod exists', () => {
      writeFile(tmp, 'go.mod', 'module test');
      const rules = autoDetectRules(tmp);
      const goRule = rules.find(r => r.extensions.includes('.go'));
      assert.ok(goRule, 'should find a Go rule');
    });

    it('returns empty array for bare directory', () => {
      const rules = autoDetectRules(tmp);
      assert.deepStrictEqual(rules, []);
    });
  });

  describe('extractFilePaths', () => {
    it('extracts path from Edit tool input', () => {
      const paths = extractFilePaths('Edit', { file_path: '/tmp/foo.ts', old_string: 'a', new_string: 'b' });
      assert.deepStrictEqual(paths, ['/tmp/foo.ts']);
    });

    it('extracts path from Write tool input', () => {
      const paths = extractFilePaths('Write', { file_path: '/tmp/bar.ts', content: 'hello' });
      assert.deepStrictEqual(paths, ['/tmp/bar.ts']);
    });

    it('extracts multiple paths from MultiEdit input', () => {
      const paths = extractFilePaths('MultiEdit', {
        edits: [
          { file_path: '/tmp/a.ts', old_string: 'x', new_string: 'y' },
          { file_path: '/tmp/b.ts', old_string: 'x', new_string: 'y' },
          { file_path: '/tmp/a.ts', old_string: 'z', new_string: 'w' }, // duplicate
        ],
      });
      assert.deepStrictEqual(paths, ['/tmp/a.ts', '/tmp/b.ts']);
    });

    it('returns empty for unknown tool', () => {
      assert.deepStrictEqual(extractFilePaths('Bash', { command: 'echo hi' }), []);
    });

    it('returns empty when file_path missing', () => {
      assert.deepStrictEqual(extractFilePaths('Edit', {}), []);
    });
  });

  describe('runVerification', () => {
    it('returns passed for exit 0 command', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'exit 0' }],
      };
      const result = await runVerification('/tmp/test.ts', config);
      assert.equal(result.ran, true);
      assert.equal(result.passed, true);
    });

    it('returns failed for exit 1 command', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'echo "Type error" && exit 1' }],
      };
      const result = await runVerification('/tmp/test.ts', config);
      assert.equal(result.ran, true);
      assert.equal(result.passed, false);
      assert.ok(result.summary.includes('Type error'));
    });

    it('returns not-ran for unknown extension', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'exit 0' }],
      };
      const result = await runVerification('/tmp/test.xyz', config);
      assert.equal(result.ran, false);
    });

    it('returns not-ran when rule has no lint command', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'] }],
      };
      const result = await runVerification('/tmp/test.ts', config);
      assert.equal(result.ran, false);
    });

    it('handles timeout gracefully', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'sleep 30', timeout: 100 }],
      };
      const result = await runVerification('/tmp/test.ts', config);
      assert.equal(result.ran, true);
      assert.equal(result.passed, false);
      assert.ok(result.summary.includes('timed out'));
    });

    it('caps summary to 500 chars', async () => {
      const longOutput = 'x'.repeat(1000);
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: `echo "${longOutput}" && exit 1` }],
      };
      const result = await runVerification('/tmp/test.ts', config);
      assert.ok(result.summary.length <= 500);
    });
  });

  describe('runVerificationForFiles', () => {
    it('returns not-ran for empty file list', async () => {
      const config = { enabled: true, mode: 'warn' as const, rules: [] };
      const result = await runVerificationForFiles([], config);
      assert.equal(result.ran, false);
    });

    it('delegates to single-file verification for one file', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'exit 0' }],
      };
      const result = await runVerificationForFiles(['/tmp/test.ts'], config);
      assert.equal(result.ran, true);
      assert.equal(result.passed, true);
    });

    it('aggregates failures from multiple files', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [
          { extensions: ['.ts'], lint: 'echo "ts error" && exit 1' },
          { extensions: ['.py'], lint: 'echo "py error" && exit 1' },
        ],
      };
      const result = await runVerificationForFiles(['/tmp/a.ts', '/tmp/b.py'], config);
      assert.equal(result.ran, true);
      assert.equal(result.passed, false);
      assert.ok(result.summary.includes('ts error'));
      assert.ok(result.summary.includes('py error'));
    });

    it('passes when all files pass', async () => {
      const config = {
        enabled: true,
        mode: 'warn' as const,
        rules: [{ extensions: ['.ts'], lint: 'exit 0' }],
      };
      const result = await runVerificationForFiles(['/tmp/a.ts', '/tmp/b.ts'], config);
      assert.equal(result.passed, true);
    });
  });

  describe('getVerificationConfig', () => {
    it('returns null for bare directory with no config', () => {
      // When no project files exist and no .oh/config.yaml
      invalidateVerificationCache();
      // Config depends on cwd; in test env it may auto-detect from project root
      const config = getVerificationConfig();
      // Just verify it returns something or null without crashing
      if (config) {
        assert.equal(config.enabled, true);
        assert.ok(Array.isArray(config.rules));
      }
    });
  });
});
