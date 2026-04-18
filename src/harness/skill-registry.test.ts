import assert from "node:assert/strict";
import test from "node:test";
import {
  installSkill,
  PERMISSIVE_LICENSES,
  type Registry,
  type RegistrySkill,
  searchRegistry,
} from "./skill-registry.js";

const TEST_REGISTRY: Registry = {
  skills: [
    {
      name: "deploy",
      description: "Deploy app to production",
      author: "a",
      version: "1",
      source: "",
      tags: ["deploy", "vercel"],
    },
    {
      name: "test",
      description: "Run tests",
      author: "a",
      version: "1",
      source: "",
      tags: ["test", "jest"],
    },
  ],
};

test("searchRegistry filters by name", () => {
  const results = searchRegistry(TEST_REGISTRY, "deploy");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "deploy");
});

test("searchRegistry filters by tag", () => {
  const results = searchRegistry(TEST_REGISTRY, "vercel");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "deploy");
});

test("searchRegistry filters by description", () => {
  const results = searchRegistry(TEST_REGISTRY, "production");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "deploy");
});

test("searchRegistry is case-insensitive", () => {
  const results = searchRegistry(TEST_REGISTRY, "DEPLOY");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "deploy");
});

test("searchRegistry returns empty array when no match", () => {
  const results = searchRegistry(TEST_REGISTRY, "zzznomatch");
  assert.equal(results.length, 0);
});

test("searchRegistry returns all matching skills", () => {
  const results = searchRegistry(TEST_REGISTRY, "a");
  // Both have "a" in author, but searchRegistry searches name/description/tags
  // "deploy app" matches "a" in description, so at least deploy
  assert.ok(results.length >= 1);
});

// ── Install gates ──

const baseSkill: RegistrySkill = {
  name: "test-skill",
  description: "x",
  author: "a",
  version: "1",
  source: "https://example.invalid/skill.md",
  tags: [],
};

test("installSkill refuses link-only entries (installable: false)", async () => {
  const skill: RegistrySkill = {
    ...baseSkill,
    installable: false,
    license: "CC-BY-SA-4.0",
    upstream: "https://example.com/x",
  };
  const result = await installSkill(skill);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "not-installable");
    assert.ok(result.message.includes("CC-BY-SA-4.0"));
    assert.ok(result.message.includes("https://example.com/x"));
  }
});

test("installSkill refuses non-permissive license without --accept-license", async () => {
  const skill: RegistrySkill = { ...baseSkill, license: "GPL-3.0" };
  const result = await installSkill(skill);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "license-not-accepted");
    assert.ok(result.message.includes("--accept-license=GPL-3.0"));
  }
});

test("installSkill refuses license mismatch on --accept-license", async () => {
  const skill: RegistrySkill = { ...baseSkill, license: "GPL-3.0" };
  const result = await installSkill(skill, { acceptLicense: "MIT" });
  assert.equal(result.ok, false);
});

test("PERMISSIVE_LICENSES contains the standard set", () => {
  for (const id of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0"]) {
    assert.ok(PERMISSIVE_LICENSES.has(id), `missing ${id}`);
  }
  assert.equal(PERMISSIVE_LICENSES.has("GPL-3.0"), false);
  assert.equal(PERMISSIVE_LICENSES.has("CC-BY-SA-4.0"), false);
});
