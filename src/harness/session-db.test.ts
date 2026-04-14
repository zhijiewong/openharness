import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDir } from "../test-helpers.js";
import { closeSessionDb, indexSession, openSessionDb, rebuildIndex, searchSessions } from "./session-db.js";

test("openSessionDb creates database and FTS5 table", () => {
  const tmp = makeTmpDir();
  const dbPath = join(tmp, "test.db");
  const db = openSessionDb(dbPath);

  // Verify the FTS5 table exists by querying it
  const rows = db.prepare("SELECT count(*) as c FROM sessions_fts").get() as { c: number };
  assert.equal(rows.c, 0);

  closeSessionDb(db);
});

test("indexSession inserts and searchSessions finds it", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "test.db"));

  indexSession(db, {
    sessionId: "abc123",
    content: "how do I implement a binary search tree in TypeScript",
    toolsUsed: ["read_file", "write_file"],
    model: "claude-sonnet-4-6",
    messageCount: 4,
    cost: 0.005,
    createdAt: 1000,
    updatedAt: 2000,
  });

  const results = searchSessions(db, "binary search tree");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.sessionId, "abc123");
  assert.equal(results[0]!.model, "claude-sonnet-4-6");
  assert.equal(results[0]!.messageCount, 4);
  assert.ok(results[0]!.snippet.length > 0);

  closeSessionDb(db);
});

test("searchSessions returns empty for no match", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "test.db"));

  indexSession(db, {
    sessionId: "xyz789",
    content: "deploying a kubernetes cluster",
    toolsUsed: [],
    model: "gpt-4o",
    messageCount: 2,
    cost: 0.001,
    createdAt: 1000,
    updatedAt: 2000,
  });

  const results = searchSessions(db, "quantum physics");
  assert.equal(results.length, 0);

  closeSessionDb(db);
});

test("searchSessions respects limit parameter", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "test.db"));

  for (let i = 0; i < 5; i++) {
    indexSession(db, {
      sessionId: `session-${i}`,
      content: `debugging typescript errors in the codebase run ${i}`,
      toolsUsed: [],
      model: "claude-sonnet-4-6",
      messageCount: 2,
      cost: 0.001,
      createdAt: 1000 + i,
      updatedAt: 2000 + i,
    });
  }

  const results = searchSessions(db, "typescript errors", 3);
  assert.equal(results.length, 3);

  closeSessionDb(db);
});

test("indexSession upserts on duplicate sessionId", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "test.db"));

  indexSession(db, {
    sessionId: "dup-session",
    content: "original content about python",
    toolsUsed: [],
    model: "gpt-4o",
    messageCount: 1,
    cost: 0.001,
    createdAt: 1000,
    updatedAt: 2000,
  });

  // Upsert with updated content
  indexSession(db, {
    sessionId: "dup-session",
    content: "updated content about rust programming",
    toolsUsed: ["bash"],
    model: "gpt-4o",
    messageCount: 3,
    cost: 0.003,
    createdAt: 1000,
    updatedAt: 3000,
  });

  // Should find updated content
  const rust = searchSessions(db, "rust programming");
  assert.equal(rust.length, 1);
  assert.equal(rust[0]!.sessionId, "dup-session");
  assert.equal(rust[0]!.messageCount, 3);

  // Should NOT find old content
  const python = searchSessions(db, "python");
  assert.equal(python.length, 0);

  // Only one row total
  const count = db.prepare("SELECT count(*) as c FROM sessions_fts").get() as { c: number };
  assert.equal(count.c, 1);

  closeSessionDb(db);
});

test("rebuildIndex repopulates from session JSON files", () => {
  const tmp = makeTmpDir();
  const sessionsDir = join(tmp, "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  // Write a session JSON file matching the Session type
  const session = {
    id: "rebuild-session-1",
    messages: [
      {
        role: "user",
        content: "explain quicksort algorithm please",
        uuid: "u1",
        timestamp: 1000,
      },
      {
        role: "assistant",
        content: "quicksort is a divide and conquer sorting algorithm",
        uuid: "u2",
        timestamp: 2000,
        toolCalls: [{ id: "tc1", toolName: "read_file", arguments: {} }],
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    totalCost: 0.002,
  };

  writeFileSync(join(sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2));

  const db = openSessionDb(join(tmp, "test.db"));
  const count = rebuildIndex(db, sessionsDir);

  assert.equal(count, 1);

  const results = searchSessions(db, "quicksort");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.sessionId, "rebuild-session-1");
  assert.equal(results[0]!.model, "claude-sonnet-4-6");

  closeSessionDb(db);
});

// ── FTS5 Edge Cases ──

test("searchSessions handles empty query gracefully", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "edge.db"));
  indexSession(db, {
    sessionId: "e1",
    content: "some content",
    toolsUsed: [],
    model: "test",
    messageCount: 1,
    cost: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const results = searchSessions(db, "");
  assert.ok(Array.isArray(results));
  closeSessionDb(db);
});

test("searchSessions handles special characters in query", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "special.db"));
  indexSession(db, {
    sessionId: "s1",
    content: "Fixed the authentication bug in src/auth.ts",
    toolsUsed: ["Edit"],
    model: "test",
    messageCount: 2,
    cost: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const results = searchSessions(db, "src/auth.ts");
  assert.ok(Array.isArray(results));
  closeSessionDb(db);
});
