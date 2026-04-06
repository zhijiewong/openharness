/**
 * Session persistence — save and resume conversations.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Message } from "../types/message.js";

const DEFAULT_SESSION_DIR = join(homedir(), ".oh", "sessions");

export type Session = {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  totalCost: number;
};

export function createSession(provider: string, model: string): Session {
  return {
    id: randomUUID().slice(0, 12),
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider,
    model,
    totalCost: 0,
  };
}

export function saveSession(session: Session, dir?: string): string {
  const sessionDir = dir ?? DEFAULT_SESSION_DIR;
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, `${session.id}.json`);
  session.updatedAt = Date.now();
  writeFileSync(path, JSON.stringify(session, null, 2));
  // Evict old sessions in the background (non-blocking)
  try { evictOldSessions(sessionDir); } catch { /* ignore */ }
  return path;
}

export function loadSession(id: string, dir?: string): Session {
  const sessionDir = dir ?? DEFAULT_SESSION_DIR;
  const path = join(sessionDir, `${id}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as Session;
}

export function listSessions(dir?: string): Array<{
  id: string;
  model: string;
  messages: number;
  cost: number;
  updatedAt: number;
}> {
  const sessionDir = dir ?? DEFAULT_SESSION_DIR;
  if (!existsSync(sessionDir)) return [];

  return readdirSync(sessionDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(sessionDir, f), "utf-8")) as Session;
        return {
          id: data.id,
          model: data.model ?? "",
          messages: data.messages?.length ?? 0,
          cost: data.totalCost ?? 0,
          updatedAt: data.updatedAt ?? 0,
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Returns the ID of the most recently updated session, or null if none exist. */
export function getLastSessionId(dir?: string): string | null {
  const sessions = listSessions(dir);
  return sessions.length > 0 ? sessions[0]!.id : null;
}

/** Maximum number of sessions to keep on disk. */
const MAX_SESSIONS = 100;

/**
 * Evict oldest sessions when count exceeds MAX_SESSIONS.
 * Called automatically by saveSession.
 */
export function evictOldSessions(dir?: string, maxSessions = MAX_SESSIONS): number {
  const sessionDir = dir ?? DEFAULT_SESSION_DIR;
  if (!existsSync(sessionDir)) return 0;

  const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  if (files.length <= maxSessions) return 0;

  // Sort by modification time (oldest first)
  const withStats = files.map((f) => {
    const path = join(sessionDir, f);
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Session;
      return { path, updatedAt: data.updatedAt ?? 0 };
    } catch {
      return { path, updatedAt: 0 };
    }
  }).sort((a, b) => a.updatedAt - b.updatedAt);

  const toRemove = withStats.slice(0, files.length - maxSessions);
  for (const { path } of toRemove) {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
  return toRemove.length;
}
