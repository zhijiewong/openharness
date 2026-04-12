/**
 * Sandbox — filesystem and network restrictions for tool execution.
 *
 * Limits what tools can access:
 * - File tools: only write to allowed paths
 * - Web tools: only access allowed domains
 * - Bash: restricted commands (no curl/wget by default)
 *
 * Reduces permission prompts while maintaining security.
 */

import { relative, resolve } from "node:path";
import { readOhConfig } from "./config.js";

// ── Types ──

export type SandboxConfig = {
  enabled: boolean;
  /** Paths tools can write to (glob-style, relative to cwd) */
  allowedPaths: string[];
  /** Domains WebFetch/WebSearch can access */
  allowedDomains: string[];
  /** Block all network access */
  blockNetwork: boolean;
  /** Commands blocked in Bash (default: curl, wget) */
  blockedCommands: string[];
};

const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  allowedPaths: ["."], // current directory
  allowedDomains: [], // empty = all allowed
  blockNetwork: false,
  blockedCommands: ["curl", "wget"],
};

// ── Sandbox Manager ──

let _config: SandboxConfig | null = null;

/** Get the current sandbox config */
export function getSandboxConfig(): SandboxConfig {
  if (_config) return _config;

  const ohConfig = readOhConfig();
  if (ohConfig?.sandbox) {
    _config = {
      ...DEFAULT_SANDBOX,
      ...ohConfig.sandbox,
    };
  } else {
    _config = DEFAULT_SANDBOX;
  }
  return _config;
}

/** Reset cached config */
export function invalidateSandboxCache(): void {
  _config = null;
}

/** Check if a file path is allowed for writing */
export function isPathAllowed(filePath: string): boolean {
  const config = getSandboxConfig();
  if (!config.enabled) return true;

  const resolved = resolve(filePath);
  const cwd = process.cwd();

  for (const allowed of config.allowedPaths) {
    const allowedResolved = resolve(cwd, allowed);
    // Check if the file is within the allowed directory
    const rel = relative(allowedResolved, resolved);
    if (!rel.startsWith("..") && !rel.startsWith("/")) return true;
  }

  return false;
}

/** Check if a domain is allowed for network access */
export function isDomainAllowed(url: string): boolean {
  const config = getSandboxConfig();
  if (!config.enabled) return true;
  if (config.blockNetwork) return false;
  if (config.allowedDomains.length === 0) return true;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return config.allowedDomains.some((d) => hostname === d.toLowerCase() || hostname.endsWith(`.${d.toLowerCase()}`));
  } catch {
    return false;
  }
}

/** Check if a bash command is allowed */
export function isCommandAllowed(command: string): boolean {
  const config = getSandboxConfig();
  if (!config.enabled) return true;

  const firstWord = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return !config.blockedCommands.includes(firstWord);
}

/** Get a human-readable sandbox status */
export function sandboxStatus(): string {
  const config = getSandboxConfig();
  if (!config.enabled) return "Sandbox: disabled";

  const lines = ["Sandbox: enabled"];
  lines.push(`  Allowed paths: ${config.allowedPaths.join(", ") || "none"}`);
  if (config.blockNetwork) {
    lines.push("  Network: blocked");
  } else if (config.allowedDomains.length > 0) {
    lines.push(`  Allowed domains: ${config.allowedDomains.join(", ")}`);
  } else {
    lines.push("  Network: unrestricted");
  }
  if (config.blockedCommands.length > 0) {
    lines.push(`  Blocked commands: ${config.blockedCommands.join(", ")}`);
  }
  return lines.join("\n");
}
