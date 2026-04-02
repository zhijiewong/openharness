/**
 * .oh/config.yaml — provider, model, permissionMode and other persisted settings.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { PermissionMode } from "../types/permissions.js";

export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type OhConfig = {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  apiKey?: string;
  baseUrl?: string;
  mcpServers?: McpServerConfig[];
};

function configPath(root?: string): string {
  return join(root ?? ".", ".oh", "config.yaml");
}

export function readOhConfig(root?: string): OhConfig | null {
  const p = configPath(root);
  if (!existsSync(p)) return null;
  try {
    return parse(readFileSync(p, "utf-8")) as OhConfig;
  } catch {
    return null;
  }
}

export function writeOhConfig(cfg: OhConfig, root?: string): void {
  const p = configPath(root);
  mkdirSync(join(root ?? ".", ".oh"), { recursive: true });
  writeFileSync(p, stringify(cfg));
}
