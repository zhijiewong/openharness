/**
 * Session persistence — save and resume conversations.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
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
