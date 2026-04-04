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

function yamlScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

  if (cfg.provider === "llamacpp" || cfg.provider === "lmstudio") {
    const isLmStudio = cfg.provider === "lmstudio";
    const lines = [
      "# openHarness configuration",
      `provider: ${cfg.provider}`,
      "",
      isLmStudio
        ? "# Model name — must match the model loaded in LM Studio"
        : "# Model alias — must match --alias passed to llama-server",
      ...(isLmStudio ? [] : ["# Example: llama-server --model ./llama3.gguf --port 8080 --alias llama3-local"]),
      `model: ${yamlScalar(cfg.model || "")}`,
      "",
      isLmStudio
        ? "# URL where LM Studio local server is running (default port: 1234)"
        : "# URL where llama-server is running (default port: 8080)",
      "# Note: do not include /v1 — it is added automatically",
      `baseUrl: ${yamlScalar(cfg.baseUrl || (isLmStudio ? "http://localhost:1234" : "http://localhost:8080"))}`,
      "",
      `permissionMode: ${yamlScalar(cfg.permissionMode)}`,
    ];
    if (cfg.apiKey) lines.push(`apiKey: ${yamlScalar(cfg.apiKey)}`);
    if (cfg.mcpServers?.length) {
      // fall back to stringify for mcpServers since it's complex
      lines.push("", stringify({ mcpServers: cfg.mcpServers }).trim());
    }
    writeFileSync(p, lines.join("\n") + "\n");
    return;
  }

  writeFileSync(p, stringify(cfg));
}
