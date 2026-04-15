/**
 * SkillExtractor — auto-creates skill files from session message history.
 *
 * After a session completes, if enough tool usage was observed, we ask the LLM
 * to identify reusable patterns and persist them as skill markdown files under
 * .oh/skills/auto/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills, findSimilarSkill } from "../harness/plugins.js";
import type { Provider } from "../providers/base.js";
import type { Message } from "../types/message.js";
import { createUserMessage } from "../types/message.js";

// ── Types ──

export type SkillCandidate = {
  name: string;
  description: string;
  trigger: string;
  procedure: string;
  pitfalls: string;
  verification: string;
};

// ── Helpers ──

/** Count total tool calls across all messages */
function countToolCalls(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0);
}

/** Convert a skill name to a slug suitable for a filename */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Public API ──

/**
 * Returns true if the message history has enough tool usage to warrant
 * extracting skills (5 or more total tool calls).
 */
export function shouldExtract(messages: Message[]): boolean {
  return countToolCalls(messages) >= 5;
}

/**
 * Ask the LLM to identify reusable patterns in the conversation and return
 * them as an array of SkillCandidates.
 */
export async function extractSkills(
  provider: Provider,
  messages: Message[],
  model?: string,
): Promise<SkillCandidate[]> {
  const systemPrompt = `You are a skill extraction assistant. Analyze the conversation and identify reusable patterns or procedures that could be turned into skills for future sessions.

Return a JSON array of skill candidates. Each candidate must have these fields:
- name: short kebab-case identifier (e.g. "run-tests")
- description: one-line description of what the skill does
- trigger: a short phrase that would trigger this skill (e.g. "run the tests")
- procedure: step-by-step instructions as a markdown string
- pitfalls: common mistakes to avoid as a markdown string
- verification: how to verify the skill succeeded as a markdown string

Return ONLY the JSON array, no other text. If no reusable patterns exist, return [].`;

  const prompt = createUserMessage("Analyze this conversation and extract reusable skill patterns as a JSON array.");

  const response = await provider.complete([...messages, prompt], systemPrompt, undefined, model);

  try {
    // Extract JSON from response — handle code fences if present
    const text = response.content.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? null;
    const jsonText = jsonMatch ? jsonMatch[1]!.trim() : text;
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SkillCandidate =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string" &&
        typeof (item as Record<string, unknown>).description === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Persist a skill candidate to .oh/skills/auto/<slug>.md.
 * If a file already exists, increments the version in the frontmatter.
 */
export function persistSkill(candidate: SkillCandidate, sessionId: string): string {
  const autoDir = join(".oh", "skills", "auto");
  mkdirSync(autoDir, { recursive: true });

  const slug = toSlug(candidate.name);
  const filePath = join(autoDir, `${slug}.md`);

  // Determine version
  let version = 1;
  if (existsSync(filePath)) {
    try {
      const existing = readFileSync(filePath, "utf-8");
      const versionMatch = existing.match(/^version:\s*(\d+)$/m);
      if (versionMatch) {
        version = parseInt(versionMatch[1]!, 10) + 1;
      }
    } catch {
      /* ignore */
    }
  }

  const now = new Date().toISOString();
  const content = `---
name: ${candidate.name}
description: ${candidate.description}
trigger: ${candidate.trigger}
source: auto
extractedFrom: ${sessionId}
extractedAt: ${now}
version: ${version}
timesUsed: 0
lastUsed: 0
---

## Procedure

${candidate.procedure}

## Pitfalls

${candidate.pitfalls}

## Verification

${candidate.verification}
`;

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/** Quick LLM quality check — is this skill worth keeping? */
async function isSkillWorthy(provider: Provider, candidate: SkillCandidate, model?: string): Promise<boolean> {
  try {
    const prompt = `Is this extracted skill worth saving for future reuse? Answer YES or NO (one word only).

Name: ${candidate.name}
Description: ${candidate.description}
Procedure: ${candidate.procedure}

Criteria: Is it reusable (not a one-off)? Is the procedure clear and complete? Would it save time in future sessions?`;

    const response = await provider.complete([createUserMessage(prompt)], "Answer YES or NO only.", undefined, model);
    return response.content.trim().toUpperCase().startsWith("YES");
  } catch {
    return true; // On error, allow the skill through
  }
}

/**
 * Orchestrate the full extraction pipeline:
 * 1. Check if extraction is warranted
 * 2. Ask LLM to extract skill candidates
 * 3. Deduplicate against existing skills
 * 4. Persist each new/updated candidate
 *
 * Returns the list of file paths written.
 */
export async function runExtraction(
  provider: Provider,
  messages: Message[],
  sessionId: string,
  model?: string,
): Promise<string[]> {
  if (!shouldExtract(messages)) return [];

  const candidates = await extractSkills(provider, messages, model);
  if (candidates.length === 0) return [];

  const existingSkills = discoverSkills().map((s) => ({ name: s.name, description: s.description }));
  const written: string[] = [];

  for (const candidate of candidates) {
    const similar = findSimilarSkill(candidate.name, candidate.description, existingSkills);
    if (similar) continue;

    // Quality gate: quick LLM check before persisting
    const worthy = await isSkillWorthy(provider, candidate, model);
    if (!worthy) continue;

    const filePath = persistSkill(candidate, sessionId);
    written.push(filePath);
  }

  return written;
}
