/**
 * .oh/config.yaml — provider, model, permissionMode and other persisted settings.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import type { PermissionMode } from "../types/permissions.js";

export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  riskLevel?: "low" | "medium" | "high";
  timeout?: number; // ms, default 5000
};

export type HookDef = {
  command: string;
  match?: string; // tool name pattern for preToolUse/postToolUse
};

export type HooksConfig = {
  sessionStart?: HookDef[];
  sessionEnd?: HookDef[];
  preToolUse?: HookDef[];
  postToolUse?: HookDef[];
};

export type ToolPermissionRule = {
  tool: string;       // tool name or glob pattern (e.g. "Bash", "File*")
  action: "allow" | "deny" | "ask";
  pattern?: string;   // regex pattern to match against tool input (e.g. Bash command content)
};

export type VerificationRuleConfig = {
  extensions: string[];
  lint?: string;
  timeout?: number;
};

export type OhConfig = {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  theme?: 'dark' | 'light';
  apiKey?: string;
  baseUrl?: string;
  mcpServers?: McpServerConfig[];
  hooks?: HooksConfig;
  toolPermissions?: ToolPermissionRule[];
  statusLineFormat?: string; // Template: {model} {tokens} {cost} {ctx}
  /** Verification loops — auto-run lint/typecheck after file edits */
  verification?: {
    enabled?: boolean;          // default true (auto-detect)
    mode?: 'warn' | 'block';   // default 'warn'
    rules?: VerificationRuleConfig[];
  };
  /** Memory consolidation settings */
  memory?: {
    consolidateOnExit?: boolean;  // default true
  };
};

function yamlScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function configPath(root?: string): string {
  return join(root ?? ".", ".oh", "config.yaml");
}

let _configCache: OhConfig | null | undefined;
let _configCacheRoot: string | undefined;

/** Clear cached config (call after writes or to force re-read) */
export function invalidateConfigCache(): void {
  _configCache = undefined;
  _configCacheRoot = undefined;
}

/** Path to global config: ~/.oh/config.yaml */
function globalConfigPath(): string {
  return join(homedir(), '.oh', 'config.yaml');
}

/** Read global config as fallback defaults */
function readGlobalConfig(): Partial<OhConfig> | null {
  const p = globalConfigPath();
  if (!existsSync(p)) return null;
  try {
    return parse(readFileSync(p, 'utf-8')) as Partial<OhConfig>;
  } catch { return null; }
}

export function readOhConfig(root?: string): OhConfig | null {
  const effectiveRoot = root ?? ".";
  if (_configCache !== undefined && _configCacheRoot === effectiveRoot) return _configCache;

  const p = configPath(root);

  // Layer 1: Global defaults from ~/.oh/config.yaml
  const globalCfg = readGlobalConfig();

  // Layer 2: Project config from .oh/config.yaml
  let projectCfg: OhConfig | null = null;
  if (existsSync(p)) {
    try {
      projectCfg = parse(readFileSync(p, "utf-8")) as OhConfig;
    } catch { /* ignore malformed project config */ }
  }

  // If neither exists, no config
  if (!globalCfg && !projectCfg) {
    _configCache = null; _configCacheRoot = effectiveRoot;
    return null;
  }

  // Merge: global → project (project overrides global)
  const base = { ...globalCfg, ...projectCfg } as OhConfig;

  // Layer 3: Local overrides from .oh/config.local.yaml (gitignored personal settings)
  const localPath = join(root ?? ".", ".oh", "config.local.yaml");
  if (existsSync(localPath)) {
    try {
      const local = parse(readFileSync(localPath, "utf-8")) as Partial<OhConfig>;
      if (local) {
        const merged = { ...base, ...local } as OhConfig;
        _configCache = merged; _configCacheRoot = effectiveRoot;
        return merged;
      }
    } catch { /* ignore malformed local config */ }
  }

  _configCache = base; _configCacheRoot = effectiveRoot;
  return base;
}

export function writeOhConfig(cfg: OhConfig, root?: string): void {
  invalidateConfigCache();
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
