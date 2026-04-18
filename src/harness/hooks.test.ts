import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitHook, emitHookAsync, matchesHook } from "./hooks.js";

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
