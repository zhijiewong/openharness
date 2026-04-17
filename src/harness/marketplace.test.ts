import assert from "node:assert/strict";
import test from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import {
  ccMarketplaceToOh,
  getPluginHooks,
  getPluginMcpServers,
  parseCcPluginManifest,
  parseMarketplaceJson,
} from "./marketplace.js";

test("parseCcPluginManifest returns null when manifest absent", () => {
  const dir = makeTmpDir();
  assert.equal(parseCcPluginManifest(dir), null);
});

test("parseCcPluginManifest reads minimal valid manifest", () => {
  const dir = makeTmpDir();
  writeFile(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "x", description: "y" }));
  const m = parseCcPluginManifest(dir);
  assert.ok(m);
  assert.equal(m!.name, "x");
  assert.equal(m!.description, "y");
});

test("parseCcPluginManifest reads full manifest with author/license/keywords", () => {
  const dir = makeTmpDir();
  const manifest = {
    name: "superpowers",
    description: "Core skills library",
    version: "5.0.7",
    author: { name: "Jesse Vincent", email: "jesse@fsck.com" },
    license: "MIT",
    homepage: "https://github.com/obra/superpowers",
    keywords: ["skills", "tdd"],
  };
  writeFile(dir, ".claude-plugin/plugin.json", JSON.stringify(manifest));
  const m = parseCcPluginManifest(dir);
  assert.ok(m);
  assert.equal(m!.version, "5.0.7");
  assert.equal(m!.license, "MIT");
  assert.deepEqual(m!.keywords, ["skills", "tdd"]);
});

test("parseCcPluginManifest rejects invalid JSON", () => {
  const dir = makeTmpDir();
  writeFile(dir, ".claude-plugin/plugin.json", "{ this is not valid json");
  assert.equal(parseCcPluginManifest(dir), null);
});

test("parseCcPluginManifest rejects manifest missing required fields", () => {
  const dir = makeTmpDir();
  // Missing description
  writeFile(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "incomplete" }));
  assert.equal(parseCcPluginManifest(dir), null);
});

test("parseCcPluginManifest rejects manifest with non-string name/description", () => {
  const dir = makeTmpDir();
  writeFile(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: 42, description: "y" }));
  assert.equal(parseCcPluginManifest(dir), null);
});

// ── CC marketplace.json parsing ──

test("parseMarketplaceJson accepts CC source-typed entries", () => {
  const cc = {
    name: "superpowers-dev",
    plugins: [
      {
        name: "superpowers",
        description: "Core skills",
        version: "5.0.7",
        source: { source: "github", repo: "obra/superpowers", ref: "v5.0.7" },
      },
      {
        name: "tools",
        description: "Tools collection",
        version: "1.0.0",
        source: { source: "npm", package: "@scope/tools", version: "^1.0.0" },
      },
    ],
  };
  const m = parseMarketplaceJson(JSON.stringify(cc));
  assert.ok(m);
  assert.equal(m!.plugins.length, 2);
  assert.deepEqual(m!.plugins[0]!.source, { type: "github", repo: "obra/superpowers" });
  assert.deepEqual(m!.plugins[1]!.source, { type: "npm", package: "@scope/tools" });
});

test("parseMarketplaceJson skips relative-path sources (only resolvable inside marketplace repo)", () => {
  const cc = {
    name: "local-dev",
    plugins: [
      { name: "local", description: "x", source: "./plugins/local" },
      { name: "remote", description: "y", source: { source: "github", repo: "a/b" } },
    ],
  };
  const m = parseMarketplaceJson(JSON.stringify(cc));
  assert.ok(m);
  assert.equal(m!.plugins.length, 1);
  assert.equal(m!.plugins[0]!.name, "remote");
});

test("parseMarketplaceJson accepts OH-native marketplace format", () => {
  const oh = {
    name: "oh-marketplace",
    version: 1,
    plugins: [{ name: "p1", description: "x", version: "1.0.0", source: { type: "github", repo: "a/b" } }],
  };
  const m = parseMarketplaceJson(JSON.stringify(oh));
  assert.ok(m);
  assert.equal(m!.plugins.length, 1);
  assert.deepEqual(m!.plugins[0]!.source, { type: "github", repo: "a/b" });
});

test("parseMarketplaceJson returns null for invalid JSON", () => {
  assert.equal(parseMarketplaceJson("not json"), null);
});

test("parseMarketplaceJson returns null for missing plugins array", () => {
  assert.equal(parseMarketplaceJson(JSON.stringify({ name: "x" })), null);
});

test("ccMarketplaceToOh preserves description + version + author", () => {
  const cc = {
    name: "x",
    description: "Test marketplace",
    plugins: [
      {
        name: "p1",
        description: "desc",
        version: "2.0.0",
        author: { name: "Alice", email: "a@b.com" },
        source: { source: "url" as const, url: "https://example.com/p.tgz" },
      },
    ],
  };
  const oh = ccMarketplaceToOh(cc);
  assert.equal(oh.description, "Test marketplace");
  assert.equal(oh.plugins[0]!.version, "2.0.0");
  assert.equal(oh.plugins[0]!.author, "Alice");
});

// ── Plugin-shipped extras ──

test("getPluginMcpServers returns null when .mcp.json absent", () => {
  const dir = makeTmpDir();
  assert.equal(getPluginMcpServers(dir), null);
});

test("getPluginMcpServers reads { mcpServers: {...} } shape", () => {
  const dir = makeTmpDir();
  const cfg = { mcpServers: { excel: { command: "npx", args: ["excel-mcp"] } } };
  writeFile(dir, ".mcp.json", JSON.stringify(cfg));
  const servers = getPluginMcpServers(dir);
  assert.ok(servers);
  assert.ok("excel" in servers!);
});

test("getPluginMcpServers also accepts bare server map", () => {
  const dir = makeTmpDir();
  writeFile(dir, ".mcp.json", JSON.stringify({ excel: { command: "npx" } }));
  const servers = getPluginMcpServers(dir);
  assert.ok(servers);
  assert.ok("excel" in servers!);
});

test("getPluginHooks reads hooks/hooks.json", () => {
  const dir = makeTmpDir();
  writeFile(dir, "hooks/hooks.json", JSON.stringify({ PreToolUse: [{ command: "echo pre" }] }));
  const hooks = getPluginHooks(dir);
  assert.ok(hooks);
  assert.ok("PreToolUse" in hooks!);
});

test("getPluginHooks returns null when absent", () => {
  const dir = makeTmpDir();
  assert.equal(getPluginHooks(dir), null);
});
