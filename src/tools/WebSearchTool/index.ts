import { z } from "zod";
import type { Tool, ToolResult } from "../../Tool.js";

const inputSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

const DEFAULT_LIMIT = 5;

export const WebSearchTool: Tool<typeof inputSchema> = {
  name: "WebSearch",
  description: "Search the web via DuckDuckGo and return top results.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, _context): Promise<ToolResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OpenHarness/1.0)",
        },
      });

      if (!response.ok) {
        return { output: `Error: HTTP ${response.status}`, isError: true };
      }

      const html = await response.text();

      // Parse results from DuckDuckGo HTML response
      const results: { title: string; url: string; snippet: string }[] = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      let match: RegExpExecArray | null;
      const titles: { url: string; title: string }[] = [];

      while ((match = resultRegex.exec(html)) !== null) {
        const rawUrl = match[1];
        const title = match[2].replace(/<[^>]*>/g, "").trim();
        // DuckDuckGo wraps URLs in a redirect; extract the actual URL
        const actualUrlMatch = rawUrl.match(/uddg=([^&]+)/);
        const actualUrl = actualUrlMatch ? decodeURIComponent(actualUrlMatch[1]) : rawUrl;
        titles.push({ url: actualUrl, title });
      }

      const snippets: string[] = [];
      while ((match = snippetRegex.exec(html)) !== null) {
        snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
      }

      for (let i = 0; i < Math.min(titles.length, limit); i++) {
        results.push({
          title: titles[i].title,
          url: titles[i].url,
          snippet: snippets[i] ?? "",
        });
      }

      if (results.length === 0) {
        return { output: "No results found.", isError: false };
      }

      const output = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");

      return { output, isError: false };
    } catch (err: any) {
      return { output: `Error performing search: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Search the web using DuckDuckGo and return top results. Parameters:
- query (string, required): The search query.
- limit (number, optional): Maximum number of results to return (default 5).`;
  },
};
