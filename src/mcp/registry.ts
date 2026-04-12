/**
 * MCP Server Registry — curated list of compatible MCP servers.
 *
 * Provides a browsable catalog of MCP servers that users can add
 * to their .oh/config.yaml with a single command.
 */

export type McpRegistryEntry = {
  name: string;
  package: string; // npm package name
  description: string;
  category: "filesystem" | "git" | "database" | "api" | "search" | "productivity" | "dev-tools" | "ai";
  args?: string[]; // default args
  envVars?: string[]; // required env vars (user must fill in)
  riskLevel?: "low" | "medium" | "high";
};

/**
 * Curated registry of popular MCP servers.
 * Each entry has enough info to generate the config.yaml block.
 */
export const MCP_REGISTRY: McpRegistryEntry[] = [
  // ── Filesystem ──
  {
    name: "filesystem",
    package: "@modelcontextprotocol/server-filesystem",
    description: "Read, write, and manage files on the local filesystem",
    category: "filesystem",
    args: ["/tmp"],
    riskLevel: "medium",
  },

  // ── Git & GitHub ──
  {
    name: "github",
    package: "@modelcontextprotocol/server-github",
    description: "GitHub API — issues, PRs, repos, code search",
    category: "git",
    envVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    riskLevel: "medium",
  },
  {
    name: "gitlab",
    package: "@modelcontextprotocol/server-gitlab",
    description: "GitLab API — issues, merge requests, pipelines",
    category: "git",
    envVars: ["GITLAB_PERSONAL_ACCESS_TOKEN", "GITLAB_API_URL"],
    riskLevel: "medium",
  },

  // ── Database ──
  {
    name: "sqlite",
    package: "@modelcontextprotocol/server-sqlite",
    description: "Query and modify SQLite databases",
    category: "database",
    args: ["./database.sqlite"],
    riskLevel: "medium",
  },
  {
    name: "postgres",
    package: "@modelcontextprotocol/server-postgres",
    description: "Query PostgreSQL databases (read-only by default)",
    category: "database",
    envVars: ["POSTGRES_CONNECTION_STRING"],
    riskLevel: "medium",
  },

  // ── Search & Web ──
  {
    name: "brave-search",
    package: "@modelcontextprotocol/server-brave-search",
    description: "Web search via Brave Search API",
    category: "search",
    envVars: ["BRAVE_API_KEY"],
    riskLevel: "low",
  },
  {
    name: "fetch",
    package: "@modelcontextprotocol/server-fetch",
    description: "Fetch and parse web pages, convert HTML to markdown",
    category: "search",
    riskLevel: "low",
  },

  // ── Productivity ──
  {
    name: "slack",
    package: "@modelcontextprotocol/server-slack",
    description: "Read and send Slack messages, list channels",
    category: "productivity",
    envVars: ["SLACK_BOT_TOKEN"],
    riskLevel: "high",
  },
  {
    name: "google-drive",
    package: "@anthropic/mcp-server-google-drive",
    description: "Search and read Google Drive documents",
    category: "productivity",
    envVars: ["GOOGLE_DRIVE_CREDENTIALS"],
    riskLevel: "medium",
  },
  {
    name: "linear",
    package: "@anthropic/mcp-server-linear",
    description: "Linear issue tracker — create, update, search issues",
    category: "productivity",
    envVars: ["LINEAR_API_KEY"],
    riskLevel: "medium",
  },

  // ── Dev Tools ──
  {
    name: "docker",
    package: "@modelcontextprotocol/server-docker",
    description: "Manage Docker containers, images, and volumes",
    category: "dev-tools",
    riskLevel: "high",
  },
  {
    name: "puppeteer",
    package: "@modelcontextprotocol/server-puppeteer",
    description: "Browser automation — navigate, screenshot, interact with web pages",
    category: "dev-tools",
    riskLevel: "medium",
  },
  {
    name: "memory",
    package: "@modelcontextprotocol/server-memory",
    description: "Persistent knowledge graph for long-term memory",
    category: "ai",
    riskLevel: "low",
  },
  {
    name: "sequential-thinking",
    package: "@modelcontextprotocol/server-sequential-thinking",
    description: "Step-by-step reasoning and chain-of-thought tools",
    category: "ai",
    riskLevel: "low",
  },
  {
    name: "context7",
    package: "@anthropic/mcp-server-context7",
    description: "Fetch up-to-date library documentation for any framework",
    category: "dev-tools",
    riskLevel: "low",
  },
];

/** Search the registry by name or keyword */
export function searchRegistry(query: string): McpRegistryEntry[] {
  const q = query.toLowerCase();
  return MCP_REGISTRY.filter(
    (e) =>
      e.name.includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.category.includes(q) ||
      e.package.toLowerCase().includes(q),
  );
}

/** Get all entries in a category */
export function getByCategory(category: McpRegistryEntry["category"]): McpRegistryEntry[] {
  return MCP_REGISTRY.filter((e) => e.category === category);
}

/** Get all unique categories */
export function getCategories(): string[] {
  return [...new Set(MCP_REGISTRY.map((e) => e.category))];
}

/** Generate the config.yaml block for a registry entry */
export function generateConfigBlock(entry: McpRegistryEntry): string {
  const lines = [
    `  - name: ${entry.name}`,
    `    command: npx`,
    `    args: ["-y", "${entry.package}"${entry.args ? `, ${entry.args.map((a) => `"${a}"`).join(", ")}` : ""}]`,
  ];

  if (entry.envVars && entry.envVars.length > 0) {
    lines.push("    env:");
    for (const v of entry.envVars) {
      lines.push(`      ${v}: "YOUR_${v}"`);
    }
  }

  if (entry.riskLevel && entry.riskLevel !== "medium") {
    lines.push(`    riskLevel: ${entry.riskLevel}`);
  }

  return lines.join("\n");
}

/** Format registry as a browsable list */
export function formatRegistry(entries?: McpRegistryEntry[]): string {
  const list = entries ?? MCP_REGISTRY;
  const categories = [...new Set(list.map((e) => e.category))];
  const sections: string[] = [];

  for (const cat of categories) {
    const catEntries = list.filter((e) => e.category === cat);
    const header = cat.charAt(0).toUpperCase() + cat.slice(1).replace("-", " ");
    const rows = catEntries.map(
      (e) => `  ${e.name.padEnd(20)} ${e.description}${e.envVars ? ` [requires: ${e.envVars.join(", ")}]` : ""}`,
    );
    sections.push(`${header}:\n${rows.join("\n")}`);
  }

  return sections.join("\n\n");
}
