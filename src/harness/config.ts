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

  if (cfg.provider === "llamacpp") {
    const lines = [
      "# openHarness configuration",
      `provider: llamacpp`,
      "",
      "# Model alias — must match --alias passed to llama-server",
      "# Example: llama-server --model ./llama3.gguf --port 8080 --alias llama3-local",
      `model: ${cfg.model || ""}`,
      "",
      "# URL where llama-server is running (default port: 8080)",
      `baseUrl: ${cfg.baseUrl || "http://localhost:8080"}`,
      "",
      `permissionMode: ${cfg.permissionMode}`,
    ];
    if (cfg.apiKey) lines.push(`apiKey: ${cfg.apiKey}`);
    if (cfg.mcpServers?.length) {
      // fall back to stringify for mcpServers since it's complex
      lines.push("", stringify({ mcpServers: cfg.mcpServers }).trim());
    }
    writeFileSync(p, lines.join("\n") + "\n");
    return;
  }

  writeFileSync(p, stringify(cfg));
}
