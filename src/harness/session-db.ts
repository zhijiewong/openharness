/**
 * SQLite FTS5-based session search index.
 * Provides fast full-text search over session content using BM25 ranking.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { Session } from "./session.js";

const DEFAULT_DB_PATH = join(homedir(), ".oh", "sessions.db");
const DEFAULT_SESSION_DIR = join(homedir(), ".oh", "sessions");

export type SessionIndexEntry = {
  sessionId: string;
  content: string;
  toolsUsed: string[];
  model: string;
  messageCount: number;
  cost: number;
  createdAt: number;
  updatedAt: number;
};

export type SessionSearchResult = {
  sessionId: string;
  snippet: string;
  model: string;
  messageCount: number;
  cost: number;
  updatedAt: number;
  rank: number;
};

/**
 * Opens or creates a SQLite DB with FTS5 virtual table for session search.
 */
export function openSessionDb(dbPath?: string): Database.Database {
  const path = dbPath ?? DEFAULT_DB_PATH;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const db = new Database(path);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id, content, tools_used, model,
      message_count UNINDEXED, cost UNINDEXED,
      created_at UNINDEXED, updated_at UNINDEXED
    );
  `);

  return db;
}

/**
 * Closes the SQLite database connection.
 */
export function closeSessionDb(db: Database.Database): void {
  try {
    db.close();
  } catch {
    /* skip */
  }
}

/**
 * Upserts a session index entry using delete+insert pattern.
 */
export function indexSession(db: Database.Database, entry: SessionIndexEntry): void {
  const del = db.prepare("DELETE FROM sessions_fts WHERE session_id = ?");
  const ins = db.prepare(
    "INSERT INTO sessions_fts (session_id, content, tools_used, model, message_count, cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const upsert = db.transaction(() => {
    del.run(entry.sessionId);
    ins.run(
      entry.sessionId,
      entry.content,
      entry.toolsUsed.join(" "),
      entry.model,
      entry.messageCount,
      entry.cost,
      entry.createdAt,
      entry.updatedAt,
    );
  });

  upsert();
}

/**
 * Searches sessions using FTS5 with BM25 ranking.
 * Returns results with snippets showing matching context.
 */
export function searchSessions(db: Database.Database, query: string, limit = 20): SessionSearchResult[] {
  const stmt = db.prepare(`
    SELECT
      session_id,
      snippet(sessions_fts, 1, '>>>', '<<<', '...', 64) AS snippet,
      model,
      CAST(message_count AS INTEGER) AS message_count,
      CAST(cost AS REAL) AS cost,
      CAST(updated_at AS INTEGER) AS updated_at,
      rank
    FROM sessions_fts
    WHERE sessions_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  try {
    const rows = stmt.all(query, limit) as Array<{
      session_id: string;
      snippet: string;
      model: string;
      message_count: number;
      cost: number;
      updated_at: number;
      rank: number;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      snippet: row.snippet,
      model: row.model,
      messageCount: row.message_count,
      cost: row.cost,
      updatedAt: row.updated_at,
      rank: row.rank,
    }));
  } catch (err) {
    // Only swallow FTS5 syntax errors; rethrow DB corruption or other issues
    if (err instanceof Error && (err.message.includes("fts5") || err.message.includes("syntax"))) {
      return [];
    }
    throw err;
  }
}

/**
 * Converts a Session object to a SessionIndexEntry for indexing.
 */
export function sessionToIndexEntry(session: Session): SessionIndexEntry {
  // Concatenate user + assistant message text
  const contentParts: string[] = [];
  const toolsSet = new Set<string>();

  for (const msg of session.messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      if (msg.content) {
        contentParts.push(msg.content);
      }
    }
    // Dedupe tool names from toolCalls
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolsSet.add(tc.toolName);
      }
    }
  }

  return {
    sessionId: session.id,
    content: contentParts.join(" "),
    toolsUsed: Array.from(toolsSet),
    model: session.model,
    messageCount: session.messages.length,
    cost: session.totalCost,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Rebuilds the FTS5 index from session JSON files on disk.
 */
export function rebuildIndex(db: Database.Database, sessionsDir?: string): number {
  const dir = sessionsDir ?? DEFAULT_SESSION_DIR;
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let count = 0;

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const session = JSON.parse(raw) as Session;
      const entry = sessionToIndexEntry(session);
      indexSession(db, entry);
      count++;
    } catch {
      /* skip invalid/corrupt files */
    }
  }

  return count;
}

// ── Singleton Connection ──

let _singletonDb: Database.Database | null = null;

/** Get a shared DB connection (opens once, reuses thereafter) */
export function getSessionDb(): Database.Database {
  if (!_singletonDb) {
    _singletonDb = openSessionDb();
  }
  return _singletonDb;
}

/** Close the singleton connection (call on process exit) */
export function closeGlobalSessionDb(): void {
  if (_singletonDb) {
    try {
      _singletonDb.close();
    } catch { /* ignore */ }
    _singletonDb = null;
  }
}
