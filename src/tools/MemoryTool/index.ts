import { z } from "zod";
import type { MemoryType } from "../../harness/memory.js";
import { loadActiveMemories, saveMemory, touchMemory } from "../../harness/memory.js";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  action: z.enum(["save", "list", "search"]),
  name: z.string().optional().describe("Memory name (for save)"),
  type: z
    .enum([
      "convention",
      "preference",
      "project",
      "debugging", // legacy
      "user",
      "feedback",
      "reference", // Claude Code compatible
    ])
    .optional(),
  description: z.string().optional(),
  content: z.string().optional().describe("Memory content (for save)"),
  query: z.string().optional().describe("Search query (for search)"),
  global: z.boolean().optional().describe("Save to global memory instead of project"),
});

export const MemoryTool: Tool<typeof inputSchema> = {
  name: "Memory",
  description: "Save, list, or search persistent memories that survive across sessions.",
  inputSchema,
  riskLevel: "low",
  isReadOnly(input) {
    return input.action !== "save";
  },
  isConcurrencySafe() {
    return true;
  },

  async call(input): Promise<ToolResult> {
    if (input.action === "save") {
      if (!input.name || !input.content) {
        return { output: "name and content required for save.", isError: true };
      }
      const path = saveMemory(
        input.name,
        (input.type ?? "user") as MemoryType,
        input.description ?? input.name,
        input.content,
        input.global,
      );
      return { output: `Memory saved: ${path}`, isError: false };
    }

    if (input.action === "list") {
      const memories = loadActiveMemories();
      if (memories.length === 0) return { output: "No memories saved.", isError: false };
      const lines = memories.map(
        (m) => `[${m.type}] ${m.name} (relevance: ${(m.relevance ?? 0.5).toFixed(1)}) — ${m.description}`,
      );
      return { output: lines.join("\n"), isError: false };
    }

    if (input.action === "search") {
      if (!input.query) return { output: "query required for search.", isError: true };
      const memories = loadActiveMemories();
      const q = input.query.toLowerCase();
      const matches = memories.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
      if (matches.length === 0) return { output: `No memories matching "${input.query}".`, isError: false };
      // Touch accessed memories to boost relevance
      for (const m of matches) touchMemory(m);
      const lines = matches.map((m) => `[${m.type}] ${m.name}: ${m.content.slice(0, 200)}`);
      return { output: lines.join("\n\n"), isError: false };
    }

    return { output: "Unknown action.", isError: true };
  },

  prompt() {
    return "Memory: Save/list/search persistent memories across sessions. Actions: save, list, search. Types: user (role/preferences), feedback (corrections/confirmations), project (goals/decisions), reference (external pointers). Legacy types also accepted: convention, preference, debugging.";
  },
};
