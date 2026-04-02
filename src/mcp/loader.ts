import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Tool } from '../Tool.js';
import { McpClient } from './client.js';
import { McpTool } from './McpTool.js';
import type { McpServerConfig } from './types.js';

interface OhConfig {
  mcp?: {
    servers?: McpServerConfig[];
  };
}

const connectedClients: McpClient[] = [];

/** Load MCP tools from .oh/config.yaml. Returns empty array if no config or servers fail. */
export async function loadMcpTools(): Promise<Tool[]> {
  const configPath = join(process.cwd(), '.oh', 'config.yaml');
  if (!existsSync(configPath)) return [];

  let cfg: OhConfig;
  try {
    cfg = parseYaml(readFileSync(configPath, 'utf-8')) as OhConfig;
  } catch {
    return [];
  }

  const servers = cfg?.mcp?.servers ?? [];
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
