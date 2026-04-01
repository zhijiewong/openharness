import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, saveSession, loadSession, listSessions } from "./session.js";

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
  await new Promise((r) => setTimeout(r, 50));
  saveSession(s2, tmp);
  const list = listSessions(tmp);
  assert.equal(list.length, 2);
  // Most recent first
  assert.equal(list[0]!.id, s2.id);
  assert.equal(list[1]!.id, s1.id);
});
