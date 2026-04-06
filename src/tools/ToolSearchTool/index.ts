import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";
import { DeferredMcpTool } from "../../mcp/DeferredMcpTool.js";

const inputSchema = z.object({
  query: z.string().describe("Tool name or keyword to search for"),
  maxResults: z.number().optional().default(5).describe("Maximum results to return"),
});

export const ToolSearchTool: Tool<typeof inputSchema> = {
  name: "ToolSearch",
  description: "Search for available tools by name or keyword. Resolves deferred MCP tool schemas.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() { return true; },
  isConcurrencySafe() { return true; },

  async call(input, context: ToolContext): Promise<ToolResult> {
    const allTools = context.tools ?? [];
    const query = input.query.toLowerCase();
    const max = input.maxResults ?? 5;

    // Search by name or description
    const matches = allTools
      .filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query),
      )
      .slice(0, max);

    if (matches.length === 0) {
      return { output: `No tools found matching "${input.query}".`, isError: false };
    }

    // Resolve deferred tools to get their full schemas
    const results: string[] = [];
    for (const tool of matches) {
      if (tool instanceof DeferredMcpTool) {
        const resolved = await tool.getResolved();
        if (resolved) {
          results.push(`${resolved.name}: ${resolved.prompt()}`);
        } else {
          results.push(`${tool.name}: ${tool.description} (schema unavailable)`);
        }
      } else {
        results.push(`${tool.name}: ${tool.prompt().slice(0, 200)}`);
      }
    }

    return { output: results.join('\n\n'), isError: false };
  },

  prompt() {
    return `Search for available tools by name or keyword. Use this to discover MCP tools and resolve their schemas before calling them. Parameters:
- query (string, required): Tool name or keyword to search for
- maxResults (number, optional): Maximum results (default: 5)`;
  },
};
