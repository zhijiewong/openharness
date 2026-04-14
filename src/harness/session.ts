/**
 * Session persistence — save and resume conversations.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  gitBranch?: string;
  workingDir?: string;
  tools?: string[];
  /** Hibernate state — saved on exit for wake reconstruction */
  hibernate?: {
    summary?: string; // LLM-generated summary of session state
    lastUserMessage?: string; // Last thing the user said
    pendingTask?: string; // What was being worked on
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
};

export function createSession(
  provider: string,
  model: string,
  extras?: { gitBranch?: string; workingDir?: string; tools?: string[] },
): Session {
  return {
    id: randomUUID().slice(0, 12),
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider,
    model,
    totalCost: 0,
    ...(extras?.gitBranch ? { gitBranch: extras.gitBranch } : {}),
    ...(extras?.workingDir ? { workingDir: extras.workingDir } : {}),
    ...(extras?.tools ? { tools: extras.tools } : {}),
  };
}

let _evicting = false;

export function saveSession(session: Session, dir?: string): string {
  const sessionDir = dir ?? DEFAULT_SESSION_DIR;
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, `${session.id}.json`);
  session.updatedAt = Date.now();
  writeFileSync(path, JSON.stringify(session, null, 2));
  // Index session for FTS5 search (fire-and-forget, singleton connection)
  import("./session-db.js")
    .then(({ getSessionDb, indexSession: idx, sessionToIndexEntry }) => {
      try {
        idx(getSessionDb(), sessionToIndexEntry(session));
      } catch {
        /* session search is optional */
      }
    })
    .catch(() => {
      /* ignore if session-db unavailable */
    });
  // Evict old sessions (with lock to prevent concurrent eviction)
  if (!_evicting) {
    _evicting = true;
    try {
      evictOldSessions(sessionDir);
    } catch {
      /* ignore */
    }
    _evicting = false;
  }
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

/**
 * Build hibernate state from the current session.
 * Captures the last user message, recent assistant activity,
 * and a brief summary for context reconstruction on wake.
 */
export function buildHibernateState(messages: Message[]): Session["hibernate"] {
  if (messages.length === 0) return undefined;

  // Find last user message
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  // Build a brief summary from the last few exchanges
  const recentMsgs = messages.slice(-6);
  const summaryParts: string[] = [];
  for (const m of recentMsgs) {
    if (m.role === "user") {
      summaryParts.push(`User: ${m.content.slice(0, 100)}`);
    } else if (m.role === "assistant" && m.content) {
      summaryParts.push(`Assistant: ${m.content.slice(0, 100)}`);
    }
  }

  return {
    lastUserMessage: lastUser?.content.slice(0, 200),
    pendingTask: lastAssistant?.content.slice(0, 200),
    summary: summaryParts.join("\n"),
  };
}

/**
 * Generate a wake-up context message for a resumed session.
 * Tells the LLM what happened in the previous session.
 */
export function buildWakeContext(session: Session): string {
  const parts: string[] = ["[Session Resumed]"];

  if (session.workingDir) {
    parts.push(`Previous working directory: ${session.workingDir}`);
    if (session.workingDir !== process.cwd()) {
      parts.push(`WARNING: Working directory changed! Was: ${session.workingDir}, Now: ${process.cwd()}`);
    }
  }

  if (session.gitBranch) {
    parts.push(`Previous git branch: ${session.gitBranch}`);
  }

  if (session.hibernate?.summary) {
    parts.push(`\nPrevious session context:\n${session.hibernate.summary}`);
  }

  if (session.hibernate?.lastUserMessage) {
    parts.push(`\nLast user request: ${session.hibernate.lastUserMessage}`);
  }

  parts.push(`\nSession has ${session.messages.length} messages and cost $${session.totalCost.toFixed(4)} so far.`);
  parts.push(
    "Continue where you left off. If the user's last request was incomplete, acknowledge that and ask how to proceed.",
  );

  return parts.join("\n");
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
  const withStats = files
    .map((f) => {
      const path = join(sessionDir, f);
      try {
        const data = JSON.parse(readFileSync(path, "utf-8")) as Session;
        return { path, updatedAt: data.updatedAt ?? 0 };
      } catch {
        return { path, updatedAt: 0 };
      }
    })
    .sort((a, b) => a.updatedAt - b.updatedAt);

  const toRemove = withStats.slice(0, files.length - maxSessions);
  for (const { path } of toRemove) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
  return toRemove.length;
}
