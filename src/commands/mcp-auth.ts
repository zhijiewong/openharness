import { homedir } from "node:os";
import { join } from "node:path";
import { readOhConfig } from "../harness/config.js";
import { McpClient } from "../mcp/client.js";
import { normalizeMcpConfig } from "../mcp/config-normalize.js";
import { clearTokens } from "../mcp/oauth.js";
import { loadCredentials } from "../mcp/oauth-storage.js";

export type CommandResult = { output: string; handled: true };

function defaultStorageDir(): string {
  return join(homedir(), ".oh", "credentials", "mcp");
}

export async function mcpLogoutHandler(name: string, opts: { storageDir?: string } = {}): Promise<CommandResult> {
  const storageDir = opts.storageDir ?? defaultStorageDir();
  const trimmed = name.trim();
  if (!trimmed) {
    return { output: "Usage: /mcp-logout <server-name>", handled: true };
  }
  const existing = await loadCredentials(storageDir, trimmed);
  if (!existing) {
    return { output: `No credentials stored for '${trimmed}'.`, handled: true };
  }
  await clearTokens(storageDir, trimmed);
  return {
    output: `Local token for '${trimmed}' wiped. Server-side session may remain valid until expiry.`,
    handled: true,
  };
}

export async function mcpLoginHandler(name: string, opts: { storageDir?: string } = {}): Promise<CommandResult> {
  const storageDir = opts.storageDir ?? defaultStorageDir();
  const trimmed = name.trim();
  if (!trimmed) {
    return { output: "Usage: /mcp-login <server-name>", handled: true };
  }
  const cfg = readOhConfig();
  const servers = cfg?.mcpServers ?? [];
  const entry = servers.find((s) => s.name === trimmed);
  if (!entry) {
    return { output: `No MCP server named '${trimmed}' in .oh/config.yaml.`, handled: true };
  }
  const normalized = normalizeMcpConfig(entry, process.env);
  if (normalized.kind === "error") {
    return { output: `Invalid config for '${trimmed}': ${normalized.message}`, handled: true };
  }
  if (normalized.cfg.type === "stdio") {
    return { output: `Server '${trimmed}' is stdio; OAuth is not applicable.`, handled: true };
  }
  await clearTokens(storageDir, trimmed);
  try {
    const client = await McpClient.connect(entry);
    client.disconnect();
    return { output: `\u2713 Authenticated to '${trimmed}'.`, handled: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Authentication failed for '${trimmed}': ${msg}`, handled: true };
  }
}
