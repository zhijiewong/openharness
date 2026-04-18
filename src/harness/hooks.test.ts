import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import { invalidateConfigCache } from "./config.js";
import { emitHook, emitHookAsync, invalidateHookCache, matchesHook } from "./hooks.js";

describe("emitHook", () => {
  it("returns true when no hooks configured (default)", () => {
    // cachedHooks starts undefined; getHooks() reads config which returns null
    // when no .oh/config file exists, so emitHook returns true.
    const result = emitHook("sessionStart");
    assert.equal(result, true);
  });

  it('emitHook("sessionStart") returns true', () => {
    assert.equal(emitHook("sessionStart"), true);
  });

  it('emitHook("sessionEnd") returns true', () => {
    assert.equal(emitHook("sessionEnd"), true);
  });
});

describe("emitHookAsync", () => {
  it("returns true when no hooks configured", async () => {
    const result = await emitHookAsync("sessionStart");
    assert.equal(result, true);
  });
});

describe("matchesHook — matcher forms", () => {
  it("matches everything when no matcher is set", () => {
    assert.equal(matchesHook({ command: "x" }, { toolName: "Read" }), true);
    assert.equal(matchesHook({ command: "x" }, {}), true);
  });

  it("legacy substring match (back-compat)", () => {
    assert.equal(matchesHook({ command: "x", match: "Edit" }, { toolName: "FileEdit" }), true);
    assert.equal(matchesHook({ command: "x", match: "Edit" }, { toolName: "Read" }), false);
  });

  it("regex form `/pattern/flags`", () => {
    assert.equal(matchesHook({ command: "x", match: "/^File/" }, { toolName: "FileEdit" }), true);
    assert.equal(matchesHook({ command: "x", match: "/^File/" }, { toolName: "Read" }), false);
    assert.equal(matchesHook({ command: "x", match: "/(edit|write)/i" }, { toolName: "Write" }), true);
  });

  it("glob form with asterisk", () => {
    assert.equal(matchesHook({ command: "x", match: "File*" }, { toolName: "FileEdit" }), true);
    assert.equal(matchesHook({ command: "x", match: "File*" }, { toolName: "Read" }), false);
    assert.equal(matchesHook({ command: "x", match: "mcp__*__read" }, { toolName: "mcp__github__read" }), true);
    assert.equal(matchesHook({ command: "x", match: "mcp__*__read" }, { toolName: "mcp__github__write" }), false);
  });

  it("MCP naming convention via substring (still works)", () => {
    assert.equal(matchesHook({ command: "x", match: "mcp__github" }, { toolName: "mcp__github__read" }), true);
    assert.equal(matchesHook({ command: "x", match: "mcp__slack" }, { toolName: "mcp__github__read" }), false);
  });

  it("invalid regex fails closed (no match)", () => {
    // Unmatched bracket — constructor throws → matcher returns false
    assert.equal(matchesHook({ command: "x", match: "/[unclosed/" }, { toolName: "Anything" }), false);
  });
});

// ── JSON I/O hook mode (Tier A #5) ──

function withTmpCwd(fn: (dir: string) => void) {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(original);
    invalidateHookCache();
    invalidateConfigCache();
  }
}

/** Write a minimal .oh/config.yaml with a single preToolUse hook. */
function writeHookConfig(dir: string, hookDef: { command: string; jsonIO?: boolean; timeout?: number }) {
  mkdirSync(`${dir}/.oh`, { recursive: true });
  const json = JSON.stringify(hookDef.jsonIO ?? false);
  const body = [
    "provider: mock",
    "model: mock",
    "permissionMode: ask",
    "hooks:",
    "  preToolUse:",
    `    - command: ${JSON.stringify(hookDef.command)}`,
    `      jsonIO: ${json}`,
    ...(hookDef.timeout ? [`      timeout: ${hookDef.timeout}`] : []),
    "",
  ].join("\n");
  writeFileSync(`${dir}/.oh/config.yaml`, body);
  invalidateConfigCache();
  invalidateHookCache();
}

describe("hook JSON I/O mode", () => {
  it("allows tool when hook responds with {decision: 'allow'}", () => {
    withTmpCwd((dir) => {
      // Node-based hook: read stdin, echo {decision:"allow"}
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(
        scriptPath,
        "let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { JSON.parse(d); process.stdout.write(JSON.stringify({decision:'allow'})); });",
      );
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      const result = emitHook("preToolUse", { toolName: "Bash" });
      assert.equal(result, true);
    });
  });

  it("blocks tool when hook responds with {decision: 'deny'}", () => {
    withTmpCwd((dir) => {
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(
        scriptPath,
        "let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({decision:'deny',reason:'blocked'})); });",
      );
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      const result = emitHook("preToolUse", { toolName: "Bash" });
      assert.equal(result, false);
    });
  });

  it("hook receives JSON envelope on stdin containing event + context", () => {
    withTmpCwd((dir) => {
      // .cjs extension forces CommonJS so `require` is available.
      const scriptPath = `${dir}/hook.cjs`;
      const outPath = `${dir}/captured.json`;
      const outEsc = outPath.replace(/\\/g, "/");
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs');
         let d = '';
         process.stdin.on('data', c => d += c);
         process.stdin.on('end', () => {
           fs.writeFileSync('${outEsc}', d);
           process.stdout.write(JSON.stringify({decision:'allow'}));
         });`,
      );
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      emitHook("preToolUse", { toolName: "Bash", toolArgs: "ls -la" });
      const captured = JSON.parse(readFileSync(outPath, "utf-8"));
      assert.equal(captured.event, "preToolUse");
      assert.equal(captured.toolName, "Bash");
      assert.equal(captured.toolArgs, "ls -la");
    });
  });

  it("malformed JSON on stdout fails closed (deny)", () => {
    withTmpCwd((dir) => {
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(scriptPath, "process.stdout.write('this is not JSON');");
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      const result = emitHook("preToolUse", { toolName: "Bash" });
      assert.equal(result, false);
    });
  });

  it("empty stdout with exit 0 allows (falls back to exit-code gating)", () => {
    withTmpCwd((dir) => {
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(scriptPath, "process.exit(0);");
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      const result = emitHook("preToolUse", { toolName: "Bash" });
      assert.equal(result, true);
    });
  });

  it("non-zero exit blocks even with allow JSON in stdout", () => {
    withTmpCwd((dir) => {
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(scriptPath, "process.stdout.write(JSON.stringify({decision:'allow'})); process.exit(1);");
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: true });
      const result = emitHook("preToolUse", { toolName: "Bash" });
      assert.equal(result, false);
    });
  });

  it("env-var mode still works when jsonIO is false (back-compat)", () => {
    withTmpCwd((dir) => {
      // Classic env-var hook: reads $OH_TOOL_NAME, exits 0 for Read, 1 otherwise
      const scriptPath = `${dir}/hook.mjs`;
      writeFileSync(scriptPath, "process.exit(process.env.OH_TOOL_NAME === 'Read' ? 0 : 1);");
      writeHookConfig(dir, { command: `node ${JSON.stringify(scriptPath)}`, jsonIO: false });
      assert.equal(emitHook("preToolUse", { toolName: "Read" }), true);
      assert.equal(emitHook("preToolUse", { toolName: "Bash" }), false);
    });
  });
});
