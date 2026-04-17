import assert from "node:assert/strict";
import test from "node:test";
import { makeTmpDir, writeFile } from "../test-helpers.js";
import { parseCcPluginManifest } from "./marketplace.js";

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
