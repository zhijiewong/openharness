/**
 * Auto-memory system — saves learnings across sessions.
 *
 * Memories are stored as markdown files in .oh/memory/ (project-level)
 * or ~/.oh/memory/ (global). Each has YAML frontmatter with name, type, description.
 *
 * The system detects learnable patterns from assistant responses and saves them
 * without user intervention.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Provider } from "../providers/base.js";
import type { Message } from "../types/message.js";
import { createUserMessage } from "../types/message.js";

const PROJECT_MEMORY_DIR = join(".oh", "memory");
const GLOBAL_MEMORY_DIR = join(homedir(), ".oh", "memory");

// Version counter — incremented on every save, used by query loop for live injection
let _memoryVersion = 0;
export function memoryVersion(): number {
  return _memoryVersion;
}

/**
 * Memory types — supports both legacy and Claude Code-compatible names.
 * Legacy: convention, preference, project, debugging
 * New:    user, feedback, project, reference
 */
export type MemoryType =
  | "convention"
  | "preference"
  | "project"
  | "debugging" // legacy
  | "user"
  | "feedback"
  | "reference"; // new (project shared)

export type MemoryEntry = {
  name: string;
  type: MemoryType;
  description: string;
  content: string;
  filePath: string;
  relevance?: number; // 0-1 relevance score (default 0.5)
  lastAccessed?: number; // timestamp of last access
  createdAt?: number; // timestamp of creation
  accessCount?: number; // how many times accessed
};

/** Load all memories from project and global dirs */
export function loadMemories(): MemoryEntry[] {
  const entries: MemoryEntry[] = [];

  for (const dir of [PROJECT_MEMORY_DIR, GLOBAL_MEMORY_DIR]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      try {
        const filePath = join(dir, file);
        const raw = readFileSync(filePath, "utf-8");
        const entry = parseMemory(raw, filePath);
        if (entry) entries.push(entry);
      } catch {
        /* skip */
      }
    }
  }

  return entries;
}

/** Parse a memory markdown file */
function parseMemory(raw: string, filePath: string): MemoryEntry | null {
  const nameMatch = raw.match(/^name:\s*(.+)$/m);
  const typeMatch = raw.match(/^type:\s*(.+)$/m);
  const descMatch = raw.match(/^description:\s*(.+)$/m);
  if (!nameMatch) return null;

  // Content is everything after the frontmatter closing ---
  const fmEnd = raw.indexOf("---", raw.indexOf("---") + 3);
  const content = fmEnd > 0 ? raw.slice(fmEnd + 3).trim() : "";

  const relevanceMatch = raw.match(/^relevance:\s*([0-9.]+)$/m);
  const lastAccessedMatch = raw.match(/^lastAccessed:\s*(\d+)$/m);
  const createdAtMatch = raw.match(/^createdAt:\s*(\d+)$/m);
  const accessCountMatch = raw.match(/^accessCount:\s*(\d+)$/m);

  return {
    name: nameMatch[1]!.trim(),
    type: (typeMatch?.[1]?.trim() ?? "user") as MemoryType,
    description: descMatch?.[1]?.trim() ?? "",
    content,
    filePath,
    relevance: relevanceMatch ? parseFloat(relevanceMatch[1]!) : 0.5,
    lastAccessed: lastAccessedMatch ? parseInt(lastAccessedMatch[1]!, 10) : undefined,
    createdAt: createdAtMatch ? parseInt(createdAtMatch[1]!, 10) : undefined,
    accessCount: accessCountMatch ? parseInt(accessCountMatch[1]!, 10) : 0,
  };
}

/** Build a system prompt section from loaded memories (capped at MEMORY_PROMPT_MAX_CHARS) */
export function memoriesToPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";
  const header = "# Remembered Context\n";
  let result = header;
  for (const m of memories) {
    const line = `- **${m.name}** (${m.type}): ${m.content.slice(0, 200)}\n`;
    if (result.length + line.length > MEMORY_PROMPT_MAX_CHARS) break;
    result += line;
  }
  return result.trimEnd();
}

/** Save a memory entry to the project memory directory */
export function saveMemory(
  name: string,
  type: MemoryType,
  description: string,
  content: string,
  global = false,
): string {
  const dir = global ? GLOBAL_MEMORY_DIR : PROJECT_MEMORY_DIR;
  mkdirSync(dir, { recursive: true });

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 50);
  const filePath = join(dir, `${slug}.md`);

  const now = Date.now();
  const md = `---
name: ${name}
type: ${type}
description: ${description}
relevance: 0.5
createdAt: ${now}
lastAccessed: ${now}
accessCount: 0
---

${content}
`;

  writeFileSync(filePath, md);
  _memoryVersion++;
  updateMemoryIndex(dir);
  return filePath;
}

/**
 * Update or create MEMORY.md index file in the given memory directory.
 * The index is always loaded into context, providing instant awareness of all stored memories.
 * Each entry is a one-liner pointer to the individual memory file (~200 line cap).
 */
export function updateMemoryIndex(dir: string = PROJECT_MEMORY_DIR): void {
  if (!existsSync(dir)) return;

  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  const entries: Array<{ name: string; file: string; description: string }> = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      if (nameMatch) {
        entries.push({
          name: nameMatch[1]!.trim(),
          file,
          description: descMatch?.[1]?.trim() ?? "",
        });
      }
    } catch {
      /* skip */
    }
  }

  const lines = ["# Memory Index", ""];
  for (const e of entries) {
    // Keep each line under ~150 chars for readability
    const hook = e.description.length > 100 ? `${e.description.slice(0, 97)}...` : e.description;
    lines.push(`- [${e.name}](${e.file}) — ${hook}`);
  }
  lines.push("");

  writeFileSync(join(dir, "MEMORY.md"), lines.join("\n"));
}

/** Mark a memory as accessed — updates lastAccessed and accessCount in the file */
export function touchMemory(entry: MemoryEntry): void {
  try {
    let raw = readFileSync(entry.filePath, "utf-8");
    const now = Date.now();
    const newCount = (entry.accessCount ?? 0) + 1;

    // Update existing fields in frontmatter, or insert before closing ---
    if (raw.match(/^lastAccessed:/m)) {
      raw = raw.replace(/^lastAccessed:\s*\d+$/m, `lastAccessed: ${now}`);
    } else {
      // Insert before the CLOSING --- (second occurrence)
      const firstIdx = raw.indexOf("---");
      const closingIdx = raw.indexOf("---", firstIdx + 3);
      if (closingIdx > 0) {
        raw = `${raw.slice(0, closingIdx)}lastAccessed: ${now}\n${raw.slice(closingIdx)}`;
      }
    }
    if (raw.match(/^accessCount:/m)) {
      raw = raw.replace(/^accessCount:\s*\d+$/m, `accessCount: ${newCount}`);
    } else {
      const firstIdx = raw.indexOf("---");
      const closingIdx = raw.indexOf("---", firstIdx + 3);
      if (closingIdx > 0) {
        raw = `${raw.slice(0, closingIdx)}accessCount: ${newCount}\n${raw.slice(closingIdx)}`;
      }
    }

    writeFileSync(entry.filePath, raw);
    entry.lastAccessed = now;
    entry.accessCount = newCount;
  } catch {
    /* ignore write errors */
  }
}

/** Boost a memory's relevance score (capped at 1.0) */
export function boostRelevance(entry: MemoryEntry, amount = 0.1): void {
  const newRelevance = Math.min(1.0, (entry.relevance ?? 0.5) + amount);
  try {
    let raw = readFileSync(entry.filePath, "utf-8");
    if (raw.match(/^relevance:/m)) {
      raw = raw.replace(/^relevance:\s*[0-9.]+$/m, `relevance: ${newRelevance.toFixed(2)}`);
    }
    writeFileSync(entry.filePath, raw);
    entry.relevance = newRelevance;
  } catch {
    /* ignore */
  }
}

/**
 * Apply temporal decay to memory relevance.
 * Memories not accessed in >30 days lose relevance gradually.
 * Returns memories that should be pruned (relevance < 0.1).
 */
export function decayAndPrune(memories: MemoryEntry[]): { active: MemoryEntry[]; pruned: MemoryEntry[] } {
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const active: MemoryEntry[] = [];
  const pruned: MemoryEntry[] = [];

  for (const m of memories) {
    const lastAccess = m.lastAccessed ?? m.createdAt ?? now;
    const age = now - lastAccess;

    if (age > THIRTY_DAYS) {
      // Decay: lose 0.1 relevance per 30 days of inactivity
      const decayPeriods = Math.floor(age / THIRTY_DAYS);
      const decayed = Math.max(0, (m.relevance ?? 0.5) - decayPeriods * 0.1);
      m.relevance = decayed;

      if (decayed < 0.1) {
        pruned.push(m);
        continue;
      }
    }
    active.push(m);
  }

  return { active, pruned };
}

/** Load memories with decay applied, sorted by relevance */
export function loadActiveMemories(): MemoryEntry[] {
  const all = loadMemories();
  const { active } = decayAndPrune(all);
  // Sort by relevance (highest first), then by access count
  return active.sort(
    (a, b) => (b.relevance ?? 0.5) - (a.relevance ?? 0.5) || (b.accessCount ?? 0) - (a.accessCount ?? 0),
  );
}

// ── Dream Consolidation ──
// Background memory pruning and relevance persistence on session end.

/** Delete memory files that have been pruned (relevance < 0.1) */
export function deletePrunedMemories(pruned: MemoryEntry[]): number {
  // Guard: only delete files within known memory directories
  const allowedDirs = [PROJECT_MEMORY_DIR, GLOBAL_MEMORY_DIR].map((d) => resolve(d));
  let count = 0;
  for (const m of pruned) {
    const resolved = resolve(m.filePath);
    if (!allowedDirs.some((d) => resolved.startsWith(d + sep))) continue;
    try {
      unlinkSync(m.filePath);
      count++;
    } catch {
      /* ignore */
    }
  }
  return count;
}

/** Write back decayed relevance score to file frontmatter */
function persistDecayedRelevance(entry: MemoryEntry): void {
  try {
    let raw = readFileSync(entry.filePath, "utf-8");
    if (raw.match(/^relevance:/m)) {
      raw = raw.replace(/^relevance:\s*[0-9.]+$/m, `relevance: ${(entry.relevance ?? 0.5).toFixed(2)}`);
      writeFileSync(entry.filePath, raw);
    }
  } catch {
    /* ignore */
  }
}

export type ConsolidationResult = {
  total: number;
  pruned: number;
  decayed: number;
};

/**
 * Run full memory consolidation: apply decay, delete pruned files,
 * persist updated relevance scores. Designed to run on session end.
 */
export function consolidateMemories(): ConsolidationResult {
  const all = loadMemories();
  if (all.length === 0) return { total: 0, pruned: 0, decayed: 0 };

  const { active, pruned } = decayAndPrune(all);

  // Delete pruned memory files
  const prunedCount = deletePrunedMemories(pruned);

  // Persist updated relevance scores for decayed memories
  let decayedCount = 0;
  for (const m of active) {
    if ((m.relevance ?? 0.5) < 0.5) {
      persistDecayedRelevance(m);
      decayedCount++;
    }
  }

  // Refresh MEMORY.md index after pruning
  updateMemoryIndex(PROJECT_MEMORY_DIR);
  updateMemoryIndex(GLOBAL_MEMORY_DIR);

  // Skill decay: prune auto-extracted skills unused for 60 days
  let prunedSkills = 0;
  try {
    const skillsAutoDir = join(".oh", "skills", "auto");
    if (existsSync(skillsAutoDir)) {
      const SKILL_DECAY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
      for (const file of readdirSync(skillsAutoDir).filter((f) => f.endsWith(".md"))) {
        try {
          const raw = readFileSync(join(skillsAutoDir, file), "utf-8");
          const usedMatch = raw.match(/^timesUsed:\s*(\d+)$/m);
          const extractedMatch = raw.match(/^extractedAt:\s*(\d+)$/m);
          const timesUsed = usedMatch ? parseInt(usedMatch[1]!, 10) : 0;
          const extractedAt = extractedMatch ? parseInt(extractedMatch[1]!, 10) : Date.now();
          if (timesUsed < 2 && Date.now() - extractedAt > SKILL_DECAY_MS) {
            unlinkSync(join(skillsAutoDir, file));
            prunedSkills++;
          }
        } catch {
          /* skip unreadable skill files */
        }
      }
    }
  } catch {
    /* skill pruning is optional */
  }

  return { total: all.length, pruned: prunedCount + prunedSkills, decayed: decayedCount };
}

// ── User Profile ──

const USER_PROFILE_FILE = "USER.md";
const USER_PROFILE_MAX_CHARS = 1375; // Matches Hermes USER.md limit
const MEMORY_PROMPT_MAX_CHARS = 2200; // Matches Hermes MEMORY.md limit

/** Load the user profile from .oh/memory/USER.md */
export function loadUserProfile(): string {
  const filePath = join(PROJECT_MEMORY_DIR, USER_PROFILE_FILE);
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf-8");
    const fmEnd = raw.indexOf("---", raw.indexOf("---") + 3);
    return fmEnd > 0 ? raw.slice(fmEnd + 3).trim() : raw.trim();
  } catch {
    return "";
  }
}

/** Update the user profile, truncating to max chars */
export function updateUserProfile(content: string): void {
  mkdirSync(PROJECT_MEMORY_DIR, { recursive: true });
  // Truncate at last newline before max chars to avoid cutting mid-sentence
  let truncated = content;
  if (truncated.length > USER_PROFILE_MAX_CHARS) {
    const lastNewline = content.lastIndexOf("\n", USER_PROFILE_MAX_CHARS);
    truncated = lastNewline > 0 ? content.slice(0, lastNewline) : content.slice(0, USER_PROFILE_MAX_CHARS);
  }
  const md = `---
name: User Profile
type: user_profile
updatedAt: ${Date.now()}
---

${truncated}
`;
  writeFileSync(join(PROJECT_MEMORY_DIR, USER_PROFILE_FILE), md);
  _memoryVersion++;
}

/** Format user profile for system prompt injection */
export function userProfileToPrompt(): string {
  const profile = loadUserProfile();
  if (!profile) return "";
  return `# User Profile\n${profile}`;
}

/**
 * Detect if recent assistant messages contain learnable patterns.
 * Returns structured memories to save, or empty array.
 */
export async function detectMemories(
  provider: Provider,
  recentMessages: Message[],
  model?: string,
): Promise<Array<{ name: string; type: MemoryEntry["type"]; description: string; content: string }>> {
  // Only analyze if there are enough messages
  if (recentMessages.length < 4) return [];

  // Extract assistant messages from recent turns
  const assistantMsgs = recentMessages.filter((m) => m.role === "assistant" && m.content.length > 50).slice(-3);
  if (assistantMsgs.length === 0) return [];

  const contextText = assistantMsgs.map((m) => m.content.slice(0, 500)).join("\n---\n");

  const prompt = `Analyze this conversation snippet. If there are reusable learnings (coding conventions, project patterns, user preferences, debugging insights), extract them. Respond ONLY with a JSON array of objects with {name, type, description, content} or [] if nothing worth remembering.

Types: "user" (role/preferences), "feedback" (corrections/confirmations), "project" (goals/decisions), "reference" (external pointers)

Keep each memory concise (1-2 sentences). Only extract non-obvious learnings.

${contextText}`;

  try {
    const response = await provider.complete(
      [createUserMessage(prompt)],
      "You are a memory extraction system. Respond ONLY with valid JSON.",
      undefined,
      model,
    );

    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((m: any) => m.name && m.type && m.content && typeof m.content === "string");
  } catch {
    return [];
  }
}
