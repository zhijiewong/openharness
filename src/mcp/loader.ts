import type { Tool } from '../Tool.js';
import { McpClient } from './client.js';
import { McpTool } from './McpTool.js';
import { DeferredMcpTool } from './DeferredMcpTool.js';
import { readOhConfig } from '../harness/config.js';

const connectedClients: McpClient[] = [];

/** Threshold: servers with more tools than this use deferred loading */
const DEFERRED_THRESHOLD = 10;

/** Load MCP tools from .oh/config.yaml mcpServers list. Returns empty array if none configured. */
export async function loadMcpTools(): Promise<Tool[]> {
  const cfg = readOhConfig();
  const servers = cfg?.mcpServers ?? [];
  if (servers.length === 0) return [];

  const tools: Tool[] = [];

  for (const server of servers) {
    try {
      const client = await McpClient.connect(server);
      connectedClients.push(client);
      const defs = await client.listTools();

      if (defs.length > DEFERRED_THRESHOLD) {
        // Many tools → use deferred loading (name + description only, schema on demand)
        for (const def of defs) {
          tools.push(new DeferredMcpTool(client, def.name, def.description ?? '', server.riskLevel));
        }
      } else {
        // Few tools → load eagerly (full schema)
        for (const def of defs) {
          tools.push(new McpTool(client, def, server.riskLevel));
        }
      }
    } catch (err) {
      console.warn(`[mcp] Failed to connect to '${server.name}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return tools;
}

/** Disconnect all MCP clients (call on exit) */
export function disconnectMcpClients(): void {
  for (const client of connectedClients) {
    try { client.disconnect(); } catch { /* ignore */ }
  }
  connectedClients.length = 0;
}

/** Names of connected MCP servers */
export function connectedMcpServers(): string[] {
  return connectedClients.map(c => c.name);
}

/** List all available resources across connected MCP servers */
export async function listMcpResources(): Promise<Array<{ server: string; uri: string; name: string; description?: string }>> {
  const resources: Array<{ server: string; uri: string; name: string; description?: string }> = [];
  for (const client of connectedClients) {
    try {
      const serverResources = await client.listResources();
      for (const r of serverResources) {
        resources.push({ server: client.name, ...r });
      }
    } catch { /* ignore */ }
  }
  return resources;
}

/** Resolve a @mention to MCP resource content. Returns content or null. */
export async function resolveMcpMention(mention: string): Promise<string | null> {
  for (const client of connectedClients) {
    try {
      const resources = await client.listResources();
      const match = resources.find(r =>
        r.name.toLowerCase() === mention.toLowerCase() ||
        r.uri.toLowerCase().includes(mention.toLowerCase()),
      );
      if (match) {
        return await client.readResource(match.uri);
      }
    } catch { /* ignore */ }
  }
  return null;
}
