/**
 * Auto-memory system — saves learnings across sessions.
 *
 * Memories are stored as markdown files in .oh/memory/ (project-level)
 * or ~/.oh/memory/ (global). Each has YAML frontmatter with name, type, description.
 *
 * The system detects learnable patterns from assistant responses and saves them
 * without user intervention.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Message } from '../types/message.js';
import type { Provider } from '../providers/base.js';
import { createUserMessage } from '../types/message.js';

const PROJECT_MEMORY_DIR = join('.oh', 'memory');
const GLOBAL_MEMORY_DIR = join(homedir(), '.oh', 'memory');

export type MemoryEntry = {
  name: string;
  type: 'convention' | 'preference' | 'project' | 'debugging';
  description: string;
  content: string;
  filePath: string;
  relevance?: number;     // 0-1 relevance score (default 0.5)
  lastAccessed?: number;  // timestamp of last access
  createdAt?: number;     // timestamp of creation
  accessCount?: number;   // how many times accessed
};

/** Load all memories from project and global dirs */
export function loadMemories(): MemoryEntry[] {
  const entries: MemoryEntry[] = [];

  for (const dir of [PROJECT_MEMORY_DIR, GLOBAL_MEMORY_DIR]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      try {
        const filePath = join(dir, file);
        const raw = readFileSync(filePath, 'utf-8');
        const entry = parseMemory(raw, filePath);
        if (entry) entries.push(entry);
      } catch { /* skip */ }
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
  const fmEnd = raw.indexOf('---', raw.indexOf('---') + 3);
  const content = fmEnd > 0 ? raw.slice(fmEnd + 3).trim() : '';

  const relevanceMatch = raw.match(/^relevance:\s*([0-9.]+)$/m);
  const lastAccessedMatch = raw.match(/^lastAccessed:\s*(\d+)$/m);
  const createdAtMatch = raw.match(/^createdAt:\s*(\d+)$/m);
  const accessCountMatch = raw.match(/^accessCount:\s*(\d+)$/m);

  return {
    name: nameMatch[1]!.trim(),
    type: (typeMatch?.[1]?.trim() ?? 'convention') as MemoryEntry['type'],
    description: descMatch?.[1]?.trim() ?? '',
    content,
    filePath,
    relevance: relevanceMatch ? parseFloat(relevanceMatch[1]!) : 0.5,
    lastAccessed: lastAccessedMatch ? parseInt(lastAccessedMatch[1]!) : undefined,
    createdAt: createdAtMatch ? parseInt(createdAtMatch[1]!) : undefined,
    accessCount: accessCountMatch ? parseInt(accessCountMatch[1]!) : 0,
  };
}

/** Build a system prompt section from loaded memories */
export function memoriesToPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(m =>
    `- **${m.name}** (${m.type}): ${m.content.slice(0, 200)}`
  );
  return `# Remembered Context\n${lines.join('\n')}`;
}

/** Save a memory entry to the project memory directory */
export function saveMemory(
  name: string,
  type: MemoryEntry['type'],
  description: string,
  content: string,
  global = false,
): string {
  const dir = global ? GLOBAL_MEMORY_DIR : PROJECT_MEMORY_DIR;
  mkdirSync(dir, { recursive: true });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
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
  return filePath;
}

/** Mark a memory as accessed — updates lastAccessed and accessCount in the file */
export function touchMemory(entry: MemoryEntry): void {
  try {
    let raw = readFileSync(entry.filePath, 'utf-8');
    const now = Date.now();
    const newCount = (entry.accessCount ?? 0) + 1;

    // Update or insert metadata fields in frontmatter
    if (raw.match(/^lastAccessed:/m)) {
      raw = raw.replace(/^lastAccessed:\s*\d+$/m, `lastAccessed: ${now}`);
    } else {
      raw = raw.replace(/^---\s*$/m, `lastAccessed: ${now}\n---`);
    }
    if (raw.match(/^accessCount:/m)) {
      raw = raw.replace(/^accessCount:\s*\d+$/m, `accessCount: ${newCount}`);
    } else {
      raw = raw.replace(/^---\s*$/m, `accessCount: ${newCount}\n---`);
    }

    writeFileSync(entry.filePath, raw);
    entry.lastAccessed = now;
    entry.accessCount = newCount;
  } catch { /* ignore write errors */ }
}

/** Boost a memory's relevance score (capped at 1.0) */
export function boostRelevance(entry: MemoryEntry, amount = 0.1): void {
  const newRelevance = Math.min(1.0, (entry.relevance ?? 0.5) + amount);
  try {
    let raw = readFileSync(entry.filePath, 'utf-8');
    if (raw.match(/^relevance:/m)) {
      raw = raw.replace(/^relevance:\s*[0-9.]+$/m, `relevance: ${newRelevance.toFixed(2)}`);
    }
    writeFileSync(entry.filePath, raw);
    entry.relevance = newRelevance;
  } catch { /* ignore */ }
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
  return active.sort((a, b) => (b.relevance ?? 0.5) - (a.relevance ?? 0.5) || (b.accessCount ?? 0) - (a.accessCount ?? 0));
}

/**
 * Detect if recent assistant messages contain learnable patterns.
 * Returns structured memories to save, or empty array.
 */
export async function detectMemories(
  provider: Provider,
  recentMessages: Message[],
  model?: string,
): Promise<Array<{ name: string; type: MemoryEntry['type']; description: string; content: string }>> {
  // Only analyze if there are enough messages
  if (recentMessages.length < 4) return [];

  // Extract assistant messages from recent turns
  const assistantMsgs = recentMessages
    .filter(m => m.role === 'assistant' && m.content.length > 50)
    .slice(-3);
  if (assistantMsgs.length === 0) return [];

  const contextText = assistantMsgs
    .map(m => m.content.slice(0, 500))
    .join('\n---\n');

  const prompt = `Analyze this conversation snippet. If there are reusable learnings (coding conventions, project patterns, user preferences, debugging insights), extract them. Respond ONLY with a JSON array of objects with {name, type, description, content} or [] if nothing worth remembering.

Types: "convention" (code style/patterns), "preference" (user likes/dislikes), "project" (architecture/decisions), "debugging" (solutions to problems)

Keep each memory concise (1-2 sentences). Only extract non-obvious learnings.

${contextText}`;

  try {
    const response = await provider.complete(
      [createUserMessage(prompt)],
      'You are a memory extraction system. Respond ONLY with valid JSON.',
      undefined,
      model,
    );

    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (m: any) => m.name && m.type && m.content && typeof m.content === 'string',
    );
  } catch {
    return [];
  }
}
