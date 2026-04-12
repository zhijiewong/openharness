import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSession, listSessions, loadSession, saveSession } from "./session.js";

test("createSession() creates with id and empty messages", () => {
  const s = createSession("openai", "gpt-4o");
  assert.ok(s.id.length > 0);
  assert.deepEqual(s.messages, []);
  assert.equal(s.provider, "openai");
  assert.equal(s.model, "gpt-4o");
});

test("saveSession() + loadSession() roundtrip", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const s = createSession("anthropic", "claude-sonnet-4-6");
  saveSession(s, tmp);
  const loaded = loadSession(s.id, tmp);
  assert.equal(loaded.id, s.id);
  assert.equal(loaded.provider, "anthropic");
  assert.equal(loaded.model, "claude-sonnet-4-6");
});

test("listSessions() returns saved sessions sorted by updatedAt", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const s1 = createSession("openai", "gpt-4o");
  const s2 = createSession("openai", "gpt-4o-mini");
  saveSession(s1, tmp);
  // Small delay so updatedAt differs
  await new Promise((r) => setTimeout(r, 20));
  saveSession(s2, tmp);

  const list = listSessions(tmp);
  assert.equal(list.length, 2);
  // Most recent first
  assert.equal(list[0]!.id, s2.id);
  assert.equal(list[1]!.id, s1.id);
});

test("session IDs are unique across multiple creations", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const s = createSession("mock", "mock-model");
    assert.ok(!ids.has(s.id), `Duplicate session ID: ${s.id}`);
    ids.add(s.id);
  }
  assert.equal(ids.size, 50);
});

test("session preserves messages through save/load", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const s = createSession("openai", "gpt-4o");
  s.messages = [
    { role: "user", content: "hello", uuid: "u1", timestamp: Date.now() },
    { role: "assistant", content: "hi there", uuid: "u2", timestamp: Date.now() },
  ] as any;
  s.totalCost = 0.0042;
  saveSession(s, tmp);
  const loaded = loadSession(s.id, tmp);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.messages[0]!.content, "hello");
  assert.equal(loaded.messages[1]!.content, "hi there");
  assert.equal(loaded.totalCost, 0.0042);
});

test("listSessions returns empty for empty directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "oh-test-"));
  const list = listSessions(tmp);
  assert.equal(list.length, 0);
});

test("session has timestamps set on creation", () => {
  const before = Date.now();
  const s = createSession("mock", "model");
  const after = Date.now();
  assert.ok(s.createdAt >= before && s.createdAt <= after);
  assert.ok(s.updatedAt >= before && s.updatedAt <= after);
});
