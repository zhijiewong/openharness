import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "../../Tool.js";

const inputSchema = z.object({
  url: z.string(),
});

const MAX_OUTPUT = 50_000;

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
];

function isBlockedHost(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const WebFetchTool: Tool<typeof inputSchema> = {
  name: "WebFetch",
  description: "Fetch a URL and return its content as text.",
  inputSchema,
  riskLevel: "medium",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, _context): Promise<ToolResult> {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return { output: "Error: Invalid URL.", isError: true };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { output: "Error: Only http and https URLs are allowed.", isError: true };
    }

    if (isBlockedHost(url.hostname)) {
      return { output: "Error: Access to private/internal hosts is blocked.", isError: true };
    }

    try {
      const response = await fetch(input.url, {
        headers: { "User-Agent": "OpenHarness/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          output: `Error: HTTP ${response.status} ${response.statusText}`,
          isError: true,
        };
      }

      let text = await response.text();
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("html")) {
        text = stripHtml(text);
      }

      if (text.length > MAX_OUTPUT) {
        text = text.slice(0, MAX_OUTPUT) + "\n... [truncated]";
      }

      return { output: text, isError: false };
    } catch (err: any) {
      return { output: `Error fetching URL: ${err.message}`, isError: true };
    }
  },

  prompt() {
    return `Fetch a URL and return its text content. Parameters:
- url (string, required): The URL to fetch (http/https only).
HTML tags are stripped. Output is truncated at 50K characters. Private/internal hosts are blocked for security.`;
  },
};
