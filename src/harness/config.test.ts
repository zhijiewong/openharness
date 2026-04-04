import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readOhConfig, writeOhConfig } from "./config.js";

function tmp(): string {
  return mkdtempSync(tmpdir() + "/oh-cfg-test-");
}

test("readOhConfig() returns null when no config exists", () => {
  const dir = tmp();
  assert.equal(readOhConfig(dir), null);
});

test("writeOhConfig() + readOhConfig() roundtrip", () => {
  const dir = tmp();
  writeOhConfig({ provider: "openai", model: "gpt-4o", permissionMode: "ask" }, dir);
  const cfg = readOhConfig(dir);
  assert.ok(cfg !== null);
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "gpt-4o");
  assert.equal(cfg.permissionMode, "ask");
});

test("writeOhConfig() creates .oh/ directory if missing", () => {
  const dir = tmp();
  writeOhConfig({ provider: "anthropic", model: "claude-sonnet-4-6", permissionMode: "trust" }, dir);
  const cfg = readOhConfig(dir);
  assert.ok(cfg !== null);
});

test("readOhConfig() returns null on unreadable config", () => {
  const dir = tmp();
  // Don't create the .oh dir — file doesn't exist
  assert.equal(readOhConfig(dir + "/nonexistent"), null);
});

test("writeOhConfig() preserves optional fields", () => {
  const dir = tmp();
  writeOhConfig({
    provider: "openrouter",
    model: "openai/gpt-4o",
    permissionMode: "deny",
    apiKey: "sk-test",
    baseUrl: "https://openrouter.ai/api/v1",
    mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@mcp/server-fs"] }],
  }, dir);
  const cfg = readOhConfig(dir);
  assert.ok(cfg !== null);
  assert.equal(cfg.apiKey, "sk-test");
  assert.equal(cfg.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(cfg.mcpServers?.length, 1);
  assert.equal(cfg.mcpServers?.[0]?.name, "fs");
});

test("writeOhConfig() llamacpp roundtrip", () => {
  const dir = tmp();
  writeOhConfig({
    provider: "llamacpp",
    model: "llama3-local",
    permissionMode: "ask",
    baseUrl: "http://localhost:8080",
  }, dir);
  const cfg = readOhConfig(dir);
  assert.ok(cfg !== null);
  assert.equal(cfg.provider, "llamacpp");
  assert.equal(cfg.model, "llama3-local");
  assert.equal(cfg.permissionMode, "ask");
  assert.equal(cfg.baseUrl, "http://localhost:8080");
});

test("writeOhConfig() llamacpp model with colon roundtrips correctly", () => {
  const dir = tmp();
  writeOhConfig({
    provider: "llamacpp",
    model: "my:model",
    permissionMode: "trust",
    apiKey: "secret#key",
  }, dir);
  const cfg = readOhConfig(dir);
  assert.ok(cfg !== null);
  assert.equal(cfg.model, "my:model");
  assert.equal(cfg.apiKey, "secret#key");
  assert.equal(cfg.permissionMode, "trust");
});

test("writeOhConfig() overwrites existing config", () => {
  const dir = tmp();
  writeOhConfig({ provider: "openai", model: "gpt-4o", permissionMode: "ask" }, dir);
  writeOhConfig({ provider: "anthropic", model: "claude-haiku-4-5", permissionMode: "trust" }, dir);
  const cfg = readOhConfig(dir);
  assert.equal(cfg?.provider, "anthropic");
  assert.equal(cfg?.model, "claude-haiku-4-5");
});
