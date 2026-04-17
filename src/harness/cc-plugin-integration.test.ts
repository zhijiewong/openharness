/**
 * Integration test: real Claude Code plugin layout.
 *
 * Simulates the `obra/superpowers` layout in a tmp dir and verifies that OH's
 * discovery helpers surface the plugin manifest, directory-packaged skills,
 * MCP servers, hooks, and LSP servers end-to-end — without actually running
 * the marketplace install path (which requires the network).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { getPluginHooks, getPluginLspServers, getPluginMcpServers, parseCcPluginManifest } from "./marketplace.js";

test("end-to-end: simulated obra/superpowers plugin surfaces everything", () => {
  const root = makeTmpDir();

  // 1) Plugin manifest
  writeFile(
    root,
    ".claude-plugin/plugin.json",
    JSON.stringify({
      name: "superpowers",
      description: "Core skills library for Claude Code: TDD, debugging, collaboration patterns",
      version: "5.0.7",
      author: { name: "Jesse Vincent", email: "jesse@fsck.com" },
      license: "MIT",
      homepage: "https://github.com/obra/superpowers",
      keywords: ["skills", "tdd", "debugging"],
    }),
  );

  // 2) Directory-packaged skills (two skills, each with companion files)
  writeFile(
    root,
    "skills/brainstorming/SKILL.md",
    `---\nname: brainstorming\ndescription: Explore user intent before implementation\nallowed-tools: Read Glob Grep\n---\nBody of brainstorming skill.\n`,
  );
  writeFile(root, "skills/brainstorming/reference.md", "# Reference companion\n");
  writeFile(
    root,
    "skills/systematic-debugging/SKILL.md",
    `---\nname: systematic-debugging\ndescription: Structured debugging approach\nallowed-tools: Read Bash Grep\n---\nBody of debugging skill.\n`,
  );

  // 3) MCP server config
  writeFile(
    root,
    ".mcp.json",
    JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    }),
  );

  // 4) Hooks
  writeFile(
    root,
    "hooks/hooks.json",
    JSON.stringify({
      PreToolUse: [{ matcher: "Bash", command: "echo pre-bash" }],
    }),
  );

  // 5) LSP server config
  writeFile(
    root,
    ".lsp.json",
    JSON.stringify({
      lspServers: { typescript: { command: "typescript-language-server", args: ["--stdio"] } },
    }),
  );

  // Verify every piece is discovered via the public helpers

  const manifest = parseCcPluginManifest(root);
  assert.ok(manifest, "manifest should parse");
  assert.equal(manifest!.name, "superpowers");
  assert.equal(manifest!.version, "5.0.7");
  assert.equal(manifest!.license, "MIT");
  assert.deepEqual(manifest!.keywords, ["skills", "tdd", "debugging"]);

  const mcp = getPluginMcpServers(root);
  assert.ok(mcp, "mcp servers should be discovered");
  assert.ok("github" in mcp!);

  const hooks = getPluginHooks(root);
  assert.ok(hooks, "hooks should be discovered");
  assert.ok("PreToolUse" in hooks!);

  const lsp = getPluginLspServers(root);
  assert.ok(lsp, "lsp servers should be discovered");
  assert.ok("typescript" in lsp!);
});

test("end-to-end: minimal plugin (manifest only, no extras)", () => {
  const root = makeTmpDir();
  writeFile(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "minimal", description: "bare" }));
  assert.ok(parseCcPluginManifest(root));
  assert.equal(getPluginMcpServers(root), null);
  assert.equal(getPluginHooks(root), null);
  assert.equal(getPluginLspServers(root), null);
});

test("end-to-end: malformed plugin files are safely skipped", () => {
  const root = makeTmpDir();
  writeFile(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "ok", description: "ok" }));
  writeFile(root, ".mcp.json", "{ this is not json");
  writeFile(root, "hooks/hooks.json", "also not json");
  writeFile(root, ".lsp.json", "nope");
  assert.ok(parseCcPluginManifest(root));
  assert.equal(getPluginMcpServers(root), null);
  assert.equal(getPluginHooks(root), null);
  assert.equal(getPluginLspServers(root), null);
});
