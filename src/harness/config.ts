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

const CONFIG_DIR = ".oh";
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

export function readOhConfig(): OhConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return parse(raw) as OhConfig;
  } catch {
    return null;
  }
}

export function writeOhConfig(cfg: OhConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, stringify(cfg));
}
