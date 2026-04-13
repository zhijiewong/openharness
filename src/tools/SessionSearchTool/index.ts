import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { closeSessionDb, openSessionDb, searchSessions } from "../../harness/session-db.js";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

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

      const lines = results.map(
        (r, i) =>
          `${i + 1}. [${r.sessionId}] ${r.model} (${r.messageCount} msgs, $${r.cost.toFixed(3)})\n   ${r.snippet}`,
      );
      return { output: `Found ${results.length} matching session(s):\n\n${lines.join("\n\n")}`, isError: false };
    } catch (err) {
      return { output: `Session search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },

  prompt() {
    return "SessionSearch: Search past sessions for relevant context using full-text search. Use when the current task may relate to previous work. Returns snippets from matching sessions ranked by relevance.";
  },
};
