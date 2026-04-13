# Self-Evolving Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 Hermes-inspired features — self-evolving skills, session search (SQLite FTS5), progressive skill disclosure, and user modeling — that make openHarness learn and improve from every session.

**Architecture:** At session end, a `SkillExtractor` analyzes message history and creates reusable skills. Sessions are indexed into SQLite FTS5 for cross-session search. Skills use progressive disclosure (Level 0 summaries in prompt, full content on demand). A USER.md file auto-maintains a curated user profile.

**Tech Stack:** TypeScript, better-sqlite3, existing EvaluatorLoop, existing memory/session/skills systems.

**Spec:** `docs/superpowers/specs/2026-04-13-self-evolving-agent-design.md`

---

## File Structure

### New files:
| File | Responsibility |
|------|---------------|
| `src/harness/session-db.ts` | SQLite FTS5 connection, indexing, search queries |
| `src/harness/session-db.test.ts` | Tests for session DB |
| `src/services/SkillExtractor.ts` | LLM-based skill extraction from session messages |
| `src/services/SkillExtractor.test.ts` | Tests for skill extraction |
| `src/tools/SessionSearchTool/index.ts` | Deferred tool for agent to search past sessions |

### Modified files:
| File | Changes |
|------|---------|
| `src/harness/session.ts` | Call `indexSession()` after `saveSession()` |
| `src/harness/plugins.ts` | `skillsToPrompt()` → Level 0 only; add `findSimilarSkill()` |
| `src/harness/memory.ts` | Add `loadUserProfile()`, `updateUserProfile()` |
| `src/tools/SkillTool/index.ts` | Add `path` param for Level 2 files |
| `src/tools.ts` | Register `SessionSearchTool` as deferred |
| `src/commands/index.ts` | Add `/rebuild-sessions` command |
| `src/repl.ts` | Enrich sessionEnd hook context; call skill extraction + user profile update |
| `package.json` | Add `better-sqlite3` dependency |

---

### Task 1: Install better-sqlite3 and create session-db module

**Files:**
- Modify: `package.json`
- Create: `src/harness/session-db.ts`
- Create: `src/harness/session-db.test.ts`

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Write failing tests for session-db**

Create `src/harness/session-db.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { makeTmpDir } from "../test-helpers.js";
import { openSessionDb, indexSession, searchSessions, rebuildIndex, closeSessionDb } from "./session-db.js";

test("openSessionDb creates database and FTS5 table", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "sessions.db"));
  assert.ok(db);
  closeSessionDb(db);
});

test("indexSession inserts session content into FTS5", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "sessions.db"));
  indexSession(db, {
    sessionId: "test-1",
    content: "Fix the authentication bug in login flow",
    toolsUsed: ["FileEdit", "Bash", "Grep"],
    model: "claude-opus-4-6",
    messageCount: 12,
    cost: 0.05,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const results = searchSessions(db, "authentication bug");
  assert.equal(results.length, 1);
  assert.equal(results[0].sessionId, "test-1");
  closeSessionDb(db);
});

test("searchSessions returns empty for no match", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "sessions.db"));
  indexSession(db, {
    sessionId: "test-2",
    content: "Refactored the renderer for better performance",
    toolsUsed: ["FileEdit"],
    model: "gpt-4o",
    messageCount: 5,
    cost: 0.01,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const results = searchSessions(db, "authentication");
  assert.equal(results.length, 0);
  closeSessionDb(db);
});

test("searchSessions respects limit parameter", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "sessions.db"));
  for (let i = 0; i < 10; i++) {
    indexSession(db, {
      sessionId: `sess-${i}`,
      content: `Session about testing feature ${i}`,
      toolsUsed: ["Bash"],
      model: "llama3",
      messageCount: 3,
      cost: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  const results = searchSessions(db, "testing feature", 3);
  assert.equal(results.length, 3);
  closeSessionDb(db);
});

test("indexSession upserts on duplicate sessionId", () => {
  const tmp = makeTmpDir();
  const db = openSessionDb(join(tmp, "sessions.db"));
  indexSession(db, {
    sessionId: "upsert-1",
    content: "Original content",
    toolsUsed: ["Read"],
    model: "gpt-4o",
    messageCount: 2,
    cost: 0.01,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  indexSession(db, {
    sessionId: "upsert-1",
    content: "Updated content with new details",
    toolsUsed: ["Read", "Edit"],
    model: "gpt-4o",
    messageCount: 5,
    cost: 0.03,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const results = searchSessions(db, "Updated content");
  assert.equal(results.length, 1);
  assert.equal(results[0].sessionId, "upsert-1");
  closeSessionDb(db);
});

test("rebuildIndex repopulates from session JSON files", () => {
  const tmp = makeTmpDir();
  const sessionsDir = join(tmp, "sessions");
  const { mkdirSync, writeFileSync } = require("node:fs");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, "abc.json"), JSON.stringify({
    id: "abc",
    messages: [
      { role: "user", content: "Fix the bug", uuid: "1", timestamp: Date.now() },
      { role: "assistant", content: "I found the issue", uuid: "2", timestamp: Date.now() },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider: "ollama",
    model: "llama3",
    totalCost: 0,
  }));
  const db = openSessionDb(join(tmp, "sessions.db"));
  rebuildIndex(db, sessionsDir);
  const results = searchSessions(db, "Fix the bug");
  assert.equal(results.length, 1);
  assert.equal(results[0].sessionId, "abc");
  closeSessionDb(db);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx tsx --test src/harness/session-db.test.ts
```
Expected: FAIL — module `./session-db.js` not found

- [ ] **Step 4: Implement session-db module**

Create `src/harness/session-db.ts`:

```typescript
/**
 * Session search database — SQLite FTS5 index for cross-session search.
 *
 * The JSON files in ~/.oh/sessions/ remain the source of truth.
 * This DB is a search index that can be rebuilt from those files.
 */

import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session } from "./session.js";

const DEFAULT_DB_PATH = join(homedir(), ".oh", "sessions.db");

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

export function openSessionDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id,
      content,
      tools_used,
      model,
      message_count UNINDEXED,
      cost UNINDEXED,
      created_at UNINDEXED,
      updated_at UNINDEXED
    );
  `);
  return db;
}

export function closeSessionDb(db: Database.Database): void {
  db.close();
}

export function indexSession(db: Database.Database, entry: SessionIndexEntry): void {
  // Delete existing entry for this session (upsert pattern)
  db.prepare("DELETE FROM sessions_fts WHERE session_id = ?").run(entry.sessionId);
  db.prepare(`
    INSERT INTO sessions_fts (session_id, content, tools_used, model, message_count, cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.sessionId,
    entry.content,
    entry.toolsUsed.join(", "),
    entry.model,
    entry.messageCount,
    entry.cost,
    entry.createdAt,
    entry.updatedAt,
  );
}

export function searchSessions(
  db: Database.Database,
  query: string,
  limit: number = 5,
): SessionSearchResult[] {
  const escaped = query.replace(/"/g, '""');
  const rows = db.prepare(`
    SELECT session_id, snippet(sessions_fts, 1, '>>>', '<<<', '...', 64) as snippet,
           model, message_count, cost, updated_at, rank
    FROM sessions_fts
    WHERE sessions_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(`"${escaped}"`, limit) as Array<{
    session_id: string;
    snippet: string;
    model: string;
    message_count: number;
    cost: number;
    updated_at: number;
    rank: number;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    snippet: r.snippet,
    model: r.model,
    messageCount: r.message_count,
    cost: r.cost,
    updatedAt: r.updated_at,
    rank: r.rank,
  }));
}

/** Rebuild the FTS5 index from all session JSON files */
export function rebuildIndex(
  db: Database.Database,
  sessionsDir: string = join(homedir(), ".oh", "sessions"),
): number {
  if (!existsSync(sessionsDir)) return 0;

  db.exec("DELETE FROM sessions_fts");
  let count = 0;

  for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8")) as Session;
      const content = session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => m.content)
        .join("\n");
      const toolsUsed = [
        ...new Set(
          session.messages
            .flatMap((m) => m.toolCalls?.map((tc) => tc.toolName) ?? []),
        ),
      ];
      indexSession(db, {
        sessionId: session.id,
        content,
        toolsUsed,
        model: session.model,
        messageCount: session.messages.length,
        cost: session.totalCost,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
      count++;
    } catch { /* skip corrupted files */ }
  }

  return count;
}

/** Helper: extract indexable content from a Session object */
export function sessionToIndexEntry(session: Session): SessionIndexEntry {
  const content = session.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content)
    .join("\n");
  const toolsUsed = [
    ...new Set(
      session.messages.flatMap((m) => m.toolCalls?.map((tc) => tc.toolName) ?? []),
    ),
  ];
  return {
    sessionId: session.id,
    content,
    toolsUsed,
    model: session.model,
    messageCount: session.messages.length,
    cost: session.totalCost,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx tsx --test src/harness/session-db.test.ts
```
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/harness/session-db.ts src/harness/session-db.test.ts package.json package-lock.json
git commit -m "feat: add session-db module with SQLite FTS5 search index"
```

---

### Task 2: Create SessionSearchTool and wire into session.ts

**Files:**
- Create: `src/tools/SessionSearchTool/index.ts`
- Modify: `src/tools.ts`
- Modify: `src/harness/session.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: Write failing test for SessionSearchTool in tools-basic.test.ts**

Add to end of `src/tools/tools-basic.test.ts` (before closing `});`):

```typescript
  // ── SessionSearchTool ──

  it("SessionSearchTool — returns no results for empty DB", async () => {
    const { SessionSearchTool } = await import("./SessionSearchTool/index.js");
    const tmp = makeTmpDir();
    const result = await SessionSearchTool.call(
      { query: "authentication" },
      ctx(tmp),
    );
    assert.equal(result.isError, false);
    assert.ok(result.output.includes("No matching sessions"));
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test src/tools/tools-basic.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create SessionSearchTool**

Create `src/tools/SessionSearchTool/index.ts`:

```typescript
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { openSessionDb, searchSessions, closeSessionDb } from "../../harness/session-db.js";

const inputSchema = z.object({
  query: z.string().describe("Search query — keywords or phrases to find in past sessions"),
  limit: z.number().optional().describe("Max results to return (default: 5)"),
});

export const SessionSearchTool: Tool<typeof inputSchema> = {
  name: "SessionSearch",
  description: "Search past sessions for relevant context. Use when the current task seems related to previous work.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input, _context: ToolContext): Promise<ToolResult> {
    try {
      const dbPath = join(homedir(), ".oh", "sessions.db");
      const db = openSessionDb(dbPath);
      const results = searchSessions(db, input.query, input.limit ?? 5);
      closeSessionDb(db);

      if (results.length === 0) {
        return { output: `No matching sessions found for "${input.query}".`, isError: false };
      }

      const lines = results.map((r, i) =>
        `${i + 1}. [${r.sessionId}] ${r.model} (${r.messageCount} msgs, $${r.cost.toFixed(3)})\n   ${r.snippet}`,
      );
      return {
        output: `Found ${results.length} matching session(s):\n\n${lines.join("\n\n")}`,
        isError: false,
      };
    } catch (err) {
      return {
        output: `Session search failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },

  prompt() {
    return "SessionSearch: Search past sessions for relevant context using full-text search. Use when the current task may relate to previous work. Returns snippets from matching sessions ranked by relevance.";
  },
};
```

- [ ] **Step 4: Register in tools.ts**

In `src/tools.ts`, add import and register as deferred:

```typescript
import { SessionSearchTool } from "./tools/SessionSearchTool/index.js";
```

Add `SessionSearchTool` to the `extended` array (alongside other deferred tools).

- [ ] **Step 5: Wire indexing into saveSession()**

In `src/harness/session.ts`, add after `writeFileSync(path, ...)`:

```typescript
// Index session for FTS5 search
try {
  const { openSessionDb, indexSession: indexSessionDb, sessionToIndexEntry, closeSessionDb } = await import("./session-db.js");
  const db = openSessionDb();
  indexSessionDb(db, sessionToIndexEntry(session));
  closeSessionDb(db);
} catch { /* session search is optional — don't block on failures */ }
```

Note: `saveSession` is currently synchronous. Use dynamic import to avoid breaking existing callers. The try/catch ensures FTS5 failures don't break session saving.

- [ ] **Step 6: Add /rebuild-sessions command**

In `src/commands/index.ts`, add before the command parser section:

```typescript
register("rebuild-sessions", "Rebuild session search index from JSON files", () => {
  try {
    const { openSessionDb, rebuildIndex, closeSessionDb } = require("../harness/session-db.js");
    const db = openSessionDb();
    const count = rebuildIndex(db);
    closeSessionDb(db);
    return { output: `Rebuilt session search index: ${count} sessions indexed.`, handled: true };
  } catch (err: any) {
    return { output: `Failed to rebuild index: ${err.message}`, handled: true };
  }
});
```

- [ ] **Step 7: Run all tests**

```bash
npx tsc --noEmit && npm test
```
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/tools/SessionSearchTool/index.ts src/tools.ts src/harness/session.ts src/commands/index.ts
git commit -m "feat: add SessionSearchTool with FTS5 and /rebuild-sessions"
```

---

### Task 3: Progressive skill disclosure

**Files:**
- Modify: `src/harness/plugins.ts`
- Modify: `src/tools/SkillTool/index.ts`

- [ ] **Step 1: Write failing test**

Add to `src/harness/plugins.test.ts` (or create if not exists):

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { skillsToPrompt } from "./plugins.js";
import type { SkillMetadata } from "./plugins.js";

test("skillsToPrompt returns Level 0 format (name + description only)", () => {
  const skills: SkillMetadata[] = [
    {
      name: "deploy",
      description: "Deploy to production",
      trigger: "deploy",
      tools: undefined,
      args: undefined,
      content: "# Deploy\n\nVery long skill content that should NOT appear in Level 0...\n".repeat(50),
      filePath: "/tmp/deploy.md",
      source: "project",
    },
  ];
  const prompt = skillsToPrompt(skills);
  assert.ok(prompt.includes("deploy"));
  assert.ok(prompt.includes("Deploy to production"));
  assert.ok(!prompt.includes("Very long skill content"), "Level 0 should NOT include full content");
  // Should be compact — under 100 chars per skill
  const lines = prompt.split("\n").filter((l) => l.startsWith("- "));
  assert.ok(lines[0].length < 100, `Line too long: ${lines[0].length} chars`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Current `skillsToPrompt` only outputs name + description (no content), so this may already pass. Run to check:

```bash
npx tsx --test src/harness/plugins.test.ts
```

- [ ] **Step 3: Modify skillsToPrompt for Level 0**

In `src/harness/plugins.ts`, the current `skillsToPrompt()` already outputs Level 0 format (name + description). Verify it stays that way. No change needed if test passes.

- [ ] **Step 4: Add path parameter to SkillTool for Level 2**

In `src/tools/SkillTool/index.ts`, update the input schema:

```typescript
const inputSchema = z.object({
  skill: z.string(),
  args: z.string().optional(),
  path: z.string().optional().describe("Path to a supporting file within the skill directory (Level 2)"),
});
```

Add Level 2 handling in the `call` method, after finding the skill:

```typescript
// Level 2: supporting file access
if (input.path && skill) {
  if (input.path.includes("..")) {
    return { output: "Error: Path traversal not allowed.", isError: true };
  }
  const skillDir = skill.filePath.replace(/\.md$/, "");
  const filePath = join(skillDir, input.path);
  try {
    const content = readFileSync(filePath, "utf-8");
    return { output: content, isError: false };
  } catch {
    return { output: `File not found: ${input.path}`, isError: true };
  }
}
```

Update the prompt() method:

```typescript
prompt() {
  return `Execute a skill by loading its definition. Skills are searched in .oh/skills/ (project) and ~/.oh/skills/ (global). Parameters:
- skill (string, required): The skill name (or "list" to see available skills).
- args (string, optional): Arguments to pass to the skill.
- path (string, optional): Path to a supporting file within the skill's directory (for reference docs, scripts, templates).`;
}
```

- [ ] **Step 5: Run all tests**

```bash
npx tsc --noEmit && npm test
```
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/harness/plugins.ts src/tools/SkillTool/index.ts
git commit -m "feat: progressive skill disclosure — Level 0 prompt, Level 2 file access"
```

---

### Task 4: SkillExtractor service

**Files:**
- Create: `src/services/SkillExtractor.ts`
- Create: `src/services/SkillExtractor.test.ts`
- Modify: `src/harness/plugins.ts`

- [ ] **Step 1: Write failing tests**

Create `src/services/SkillExtractor.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, createMockProvider } from "../test-helpers.js";
import { extractSkills, shouldExtract, findSimilarSkill } from "./SkillExtractor.js";
import type { Message } from "../types/message.js";
import { createUserMessage, createAssistantMessage } from "../types/message.js";

test("shouldExtract returns false for sessions with < 5 tool calls", () => {
  const messages: Message[] = [
    createUserMessage("hello"),
    createAssistantMessage("hi"),
  ];
  assert.equal(shouldExtract(messages), false);
});

test("shouldExtract returns true for sessions with 5+ tool calls", () => {
  const messages: Message[] = [
    createUserMessage("fix the bug"),
    {
      ...createAssistantMessage("I'll fix it"),
      toolCalls: [
        { id: "1", toolName: "Grep", arguments: {} },
        { id: "2", toolName: "Read", arguments: {} },
        { id: "3", toolName: "Edit", arguments: {} },
        { id: "4", toolName: "Bash", arguments: {} },
        { id: "5", toolName: "Read", arguments: {} },
      ],
    },
  ];
  assert.equal(shouldExtract(messages), true);
});

test("findSimilarSkill matches by name similarity", () => {
  const skills = [
    { name: "deploy-vercel", description: "Deploy to Vercel" },
    { name: "run-tests", description: "Run the test suite" },
  ];
  const match = findSimilarSkill("deploy-to-vercel", "Deploy Next.js to Vercel", skills);
  assert.ok(match);
  assert.equal(match!.name, "deploy-vercel");
});

test("findSimilarSkill returns null for no match", () => {
  const skills = [
    { name: "deploy-vercel", description: "Deploy to Vercel" },
  ];
  const match = findSimilarSkill("setup-database", "Initialize PostgreSQL database", skills);
  assert.equal(match, null);
});

test("extractSkills returns parsed candidates from LLM response", async () => {
  const mockResponse = JSON.stringify([{
    name: "fix-auth-bug",
    description: "Debug and fix authentication issues",
    trigger: "auth bug",
    procedure: "1. Check login flow\n2. Inspect token validation\n3. Fix and test",
    pitfalls: "Token expiry edge cases",
    verification: "Run auth tests",
  }]);
  const provider = createMockProvider([[
    { type: "text_delta", content: mockResponse },
    { type: "turn_complete", reason: "completed" },
  ]]);
  const messages: Message[] = [
    createUserMessage("fix the auth bug"),
    {
      ...createAssistantMessage("Found and fixed the issue"),
      toolCalls: [
        { id: "1", toolName: "Grep", arguments: {} },
        { id: "2", toolName: "Read", arguments: {} },
        { id: "3", toolName: "Edit", arguments: {} },
        { id: "4", toolName: "Bash", arguments: {} },
        { id: "5", toolName: "Read", arguments: {} },
      ],
    },
  ];
  const candidates = await extractSkills(provider, messages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "fix-auth-bug");
  assert.ok(candidates[0].procedure.includes("Check login flow"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/services/SkillExtractor.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Add findSimilarSkill to plugins.ts**

In `src/harness/plugins.ts`, add after `findTriggeredSkills`:

```typescript
/** Find a skill that's similar to a candidate (for patch-vs-create decision) */
export function findSimilarSkill(
  candidateName: string,
  candidateDescription: string,
  skills: Array<{ name: string; description: string }>,
): { name: string; description: string } | null {
  const nameWords = new Set(candidateName.toLowerCase().split(/[-_ ]+/));
  for (const skill of skills) {
    const skillWords = new Set(skill.name.toLowerCase().split(/[-_ ]+/));
    // Check word overlap (at least 50% of candidate words match)
    const overlap = [...nameWords].filter((w) => skillWords.has(w)).length;
    if (overlap >= Math.ceil(nameWords.size * 0.5)) return skill;
    // Also check description similarity
    const descWords = new Set(skill.description.toLowerCase().split(/\s+/));
    const descOverlap = candidateDescription.toLowerCase().split(/\s+/)
      .filter((w) => descWords.has(w)).length;
    if (descOverlap >= 3) return skill;
  }
  return null;
}
```

- [ ] **Step 4: Implement SkillExtractor**

Create `src/services/SkillExtractor.ts`:

```typescript
/**
 * SkillExtractor — automatically creates reusable skill files from session completions.
 *
 * Triggered at session end when 5+ tool calls were made.
 * Uses LLM to analyze message history and extract reusable patterns.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Provider } from "../providers/base.js";
import type { Message } from "../types/message.js";
import { createUserMessage } from "../types/message.js";
import { discoverSkills, findSimilarSkill } from "../harness/plugins.js";

const AUTO_SKILLS_DIR = join(".oh", "skills", "auto");
const MIN_TOOL_CALLS = 5;

export type SkillCandidate = {
  name: string;
  description: string;
  trigger: string;
  procedure: string;
  pitfalls: string;
  verification: string;
};

/** Check if a session is worth extracting skills from */
export function shouldExtract(messages: Message[]): boolean {
  const toolCallCount = messages.reduce(
    (sum, m) => sum + (m.toolCalls?.length ?? 0),
    0,
  );
  return toolCallCount >= MIN_TOOL_CALLS;
}

/** Extract skill candidates from session messages using LLM */
export async function extractSkills(
  provider: Provider,
  messages: Message[],
  model?: string,
): Promise<SkillCandidate[]> {
  const context = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const toolInfo = m.toolCalls?.length
        ? ` [tools: ${m.toolCalls.map((tc) => tc.toolName).join(", ")}]`
        : "";
      return `[${m.role}]${toolInfo} ${m.content.slice(0, 500)}`;
    })
    .join("\n---\n");

  const prompt = `Analyze this session and extract reusable skill patterns. A skill is a workflow that would be useful if a similar task came up again.

Rules:
- Only extract NON-OBVIOUS patterns (not generic "read file then edit")
- Each skill must have a clear trigger condition
- Focus on the PROCEDURE (steps), not the content
- Return a JSON array of skill objects, or [] if nothing worth extracting

Required fields per skill: name (kebab-case), description (one line), trigger (keyword), procedure (numbered steps), pitfalls (common mistakes), verification (how to confirm success)

Session:
${context}`;

  try {
    const response = await provider.complete(
      [createUserMessage(prompt)],
      "You are a skill extraction system. Return ONLY valid JSON.",
      undefined,
      model,
    );
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: any) => c.name && c.description && c.procedure,
    ) as SkillCandidate[];
  } catch {
    return [];
  }
}

/** Write a skill candidate to disk as a markdown file */
export function persistSkill(
  candidate: SkillCandidate,
  sessionId: string,
): string {
  mkdirSync(AUTO_SKILLS_DIR, { recursive: true });
  const slug = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  const filePath = join(AUTO_SKILLS_DIR, `${slug}.md`);

  // Check if skill file already exists — if so, increment version
  let version = 1;
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const versionMatch = existing.match(/^version:\s*(\d+)$/m);
    if (versionMatch) version = parseInt(versionMatch[1]!) + 1;
  }

  const md = `---
name: ${candidate.name}
description: ${candidate.description}
trigger: ${candidate.trigger}
source: auto
extractedFrom: ${sessionId}
extractedAt: ${Date.now()}
version: ${version}
---

# ${candidate.name}

## When to Use
${candidate.trigger}

## Procedure
${candidate.procedure}

## Pitfalls
${candidate.pitfalls}

## Verification
${candidate.verification}
`;

  writeFileSync(filePath, md);
  return filePath;
}

/** Run the full extraction pipeline for a session */
export async function runExtraction(
  provider: Provider,
  messages: Message[],
  sessionId: string,
  model?: string,
): Promise<string[]> {
  if (!shouldExtract(messages)) return [];

  const candidates = await extractSkills(provider, messages, model);
  if (candidates.length === 0) return [];

  const existingSkills = discoverSkills().map((s) => ({
    name: s.name,
    description: s.description,
  }));

  const persisted: string[] = [];
  for (const candidate of candidates) {
    const similar = findSimilarSkill(candidate.name, candidate.description, existingSkills);
    if (similar) {
      // Patch existing skill by overwriting with updated content
      // (version increments automatically in persistSkill)
    }
    const path = persistSkill(candidate, sessionId);
    persisted.push(path);
  }

  return persisted;
}

export { findSimilarSkill } from "../harness/plugins.js";
```

- [ ] **Step 5: Run tests**

```bash
npx tsx --test src/services/SkillExtractor.test.ts
```
Expected: All 5 tests PASS

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add src/services/SkillExtractor.ts src/services/SkillExtractor.test.ts src/harness/plugins.ts
git commit -m "feat: add SkillExtractor service for auto skill creation"
```

---

### Task 5: User modeling (USER.md)

**Files:**
- Modify: `src/harness/memory.ts`
- Modify: `src/harness/memory.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/harness/memory.test.ts`:

```typescript
test("loadUserProfile returns empty string when USER.md doesn't exist", () => {
  withTmpCwd(() => {
    const { loadUserProfile } = require("./memory.js");
    assert.equal(loadUserProfile(), "");
  });
});

test("updateUserProfile creates USER.md with content", () => {
  withTmpCwd(() => {
    const { updateUserProfile, loadUserProfile } = require("./memory.js");
    updateUserProfile("## Role\nSenior engineer\n\n## Preferences\nTerse responses");
    const profile = loadUserProfile();
    assert.ok(profile.includes("Senior engineer"));
    assert.ok(profile.includes("Terse responses"));
  });
});

test("updateUserProfile truncates to 2000 chars", () => {
  withTmpCwd(() => {
    const { updateUserProfile, loadUserProfile } = require("./memory.js");
    const longContent = "x".repeat(3000);
    updateUserProfile(longContent);
    const profile = loadUserProfile();
    assert.ok(profile.length <= 2200); // 2000 + frontmatter overhead
  });
});

test("userProfileToPrompt formats correctly", () => {
  withTmpCwd(() => {
    const { updateUserProfile, userProfileToPrompt } = require("./memory.js");
    updateUserProfile("## Role\nData scientist");
    const prompt = userProfileToPrompt();
    assert.ok(prompt.includes("# User Profile"));
    assert.ok(prompt.includes("Data scientist"));
  });
});

test("userProfileToPrompt returns empty string when no profile", () => {
  withTmpCwd(() => {
    const { userProfileToPrompt } = require("./memory.js");
    assert.equal(userProfileToPrompt(), "");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx tsx --test src/harness/memory.test.ts
```
Expected: FAIL — `loadUserProfile` not found

- [ ] **Step 3: Implement user profile functions**

Add to `src/harness/memory.ts`:

```typescript
const USER_PROFILE_FILE = "USER.md";
const USER_PROFILE_MAX_CHARS = 2000;

/** Load the user profile from .oh/memory/USER.md */
export function loadUserProfile(): string {
  const filePath = join(PROJECT_MEMORY_DIR, USER_PROFILE_FILE);
  if (!existsSync(filePath)) return "";
  try {
    const raw = readFileSync(filePath, "utf-8");
    // Strip frontmatter, return content only
    const fmEnd = raw.indexOf("---", raw.indexOf("---") + 3);
    return fmEnd > 0 ? raw.slice(fmEnd + 3).trim() : raw.trim();
  } catch {
    return "";
  }
}

/** Update the user profile, truncating to max chars */
export function updateUserProfile(content: string): void {
  mkdirSync(PROJECT_MEMORY_DIR, { recursive: true });
  const truncated = content.slice(0, USER_PROFILE_MAX_CHARS);
  const md = `---
name: User Profile
type: user_profile
updatedAt: ${Date.now()}
---

${truncated}
`;
  writeFileSync(join(PROJECT_MEMORY_DIR, USER_PROFILE_FILE), md);
}

/** Format user profile for system prompt injection */
export function userProfileToPrompt(): string {
  const profile = loadUserProfile();
  if (!profile) return "";
  return `# User Profile\n${profile}`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test src/harness/memory.test.ts
```
Expected: All tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add src/harness/memory.ts src/harness/memory.test.ts
git commit -m "feat: add user profile (USER.md) with auto-maintenance"
```

---

### Task 6: Wire everything into the session lifecycle

**Files:**
- Modify: `src/repl.ts`

- [ ] **Step 1: Read the sessionEnd section of repl.ts**

Find the `emitHookAsync("sessionEnd", ...)` call and the session save logic.

- [ ] **Step 2: Add post-session skill extraction and user profile update**

After the session is saved and before the process exits, add:

```typescript
// Post-session learning: extract skills + update user profile
try {
  const { runExtraction } = await import("./services/SkillExtractor.js");
  const { updateUserProfile, loadUserProfile, detectMemories, saveMemory } = await import("./harness/memory.js");

  // Skill extraction (if 5+ tool calls)
  const extracted = await runExtraction(provider, session.messages, session.id, model);
  if (extracted.length > 0) {
    console.log(`[learn] Extracted ${extracted.length} skill(s) from this session.`);
  }

  // User profile update (if enough messages)
  if (session.messages.length >= 6) {
    const detected = await detectMemories(provider, session.messages, model);
    const profileUpdates = detected.filter((d) => d.type === "user" || d.type === "user_profile");
    if (profileUpdates.length > 0) {
      const currentProfile = loadUserProfile();
      const newObservations = profileUpdates.map((d) => d.content).join("\n");
      // Merge: append new observations (LLM will curate on next consolidation)
      const merged = currentProfile
        ? `${currentProfile}\n\n## Recent Observations\n${newObservations}`
        : newObservations;
      updateUserProfile(merged);
    }
  }
} catch {
  /* learning is optional — don't block exit */
}
```

- [ ] **Step 3: Enrich sessionEnd hook context**

Update the `emitHookAsync("sessionEnd", ...)` call to include session metadata:

```typescript
await emitHookAsync("sessionEnd", {
  sessionId: session.id,
  tokens: String(totalInputTokens + totalOutputTokens),
  cost: String(session.totalCost),
  model,
  provider: providerName,
});
```

- [ ] **Step 4: Run all tests**

```bash
npx tsc --noEmit && npm test
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/repl.ts
git commit -m "feat: wire skill extraction and user profile into session lifecycle"
```

---

### Task 7: Integration test and final verification

**Files:**
- Modify: `src/tools/tools-basic.test.ts` (add SessionSearchTool test)
- Run full suite

- [ ] **Step 1: Add SessionSearchTool import to tools-basic.test.ts**

Already added in Task 2 Step 1.

- [ ] **Step 2: Run full test suite**

```bash
npx tsc --noEmit && npm test
```
Expected: All tests PASS (749 existing + new tests)

- [ ] **Step 3: Run biome lint**

```bash
npx biome check src/
```
Expected: 0 errors (warnings acceptable)

- [ ] **Step 4: Format new files**

```bash
npx biome check --write src/harness/session-db.ts src/harness/session-db.test.ts src/services/SkillExtractor.ts src/services/SkillExtractor.test.ts src/tools/SessionSearchTool/index.ts
```

- [ ] **Step 5: Update CHANGELOG.md**

Add v2.3.0 entry with all 4 features.

- [ ] **Step 6: Update README.md**

Update badges (test count, tool count) and feature comparison table.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: self-evolving agent — skills, session search, user modeling — v2.3.0"
```
