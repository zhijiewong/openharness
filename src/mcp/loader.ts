import type { Tool } from '../Tool.js';
import { McpClient } from './client.js';
import { McpTool } from './McpTool.js';
import { readOhConfig } from '../harness/config.js';

const connectedClients: McpClient[] = [];

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
      for (const def of defs) {
        tools.push(new McpTool(client, def));
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
