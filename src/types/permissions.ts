/**
 * Permission types — tool permission context and risk-based gating.
 */

import type { ToolPermissionRule } from "../harness/config.js";

export type PermissionMode = "ask" | "trust" | "deny" | "acceptEdits" | "plan";

export type RiskLevel = "low" | "medium" | "high";

export type PermissionResult = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly riskLevel: RiskLevel;
};

export type AskUserFn = (
  toolName: string,
  description: string,
  riskLevel?: RiskLevel,
) => Promise<boolean>;

/** Tools auto-approved in acceptEdits mode */
const EDIT_SAFE_TOOLS = new Set([
  "FileRead", "FileWrite", "FileEdit", "Glob", "Grep", "LS",
  "ImageRead", "NotebookEdit",
]);

/** Match a tool name against a pattern (supports trailing * for prefix matching) */
function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return pattern === toolName;
}

/** Find the first matching tool permission rule */
function findToolRule(rules: ToolPermissionRule[] | undefined, toolName: string): ToolPermissionRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  return rules.find(r => matchToolPattern(r.tool, toolName));
}

/** Cached tool permission rules — set by the REPL at startup */
let toolPermissionRules: ToolPermissionRule[] | undefined;

export function setToolPermissionRules(rules: ToolPermissionRule[] | undefined): void {
  toolPermissionRules = rules;
}

export function checkPermission(
  mode: PermissionMode,
  riskLevel: RiskLevel,
  isReadOnly: boolean,
  toolName?: string,
): PermissionResult {
  // Check per-tool permission rules first (highest priority)
  if (toolName) {
    const rule = findToolRule(toolPermissionRules, toolName);
    if (rule) {
      if (rule.action === "allow") return { allowed: true, reason: "tool-rule-allow", riskLevel };
      if (rule.action === "deny") return { allowed: false, reason: "tool-rule-deny", riskLevel };
      if (rule.action === "ask") return { allowed: false, reason: "needs-approval", riskLevel };
    }
  }

  // Always allow low-risk read-only
  if (riskLevel === "low" && isReadOnly) {
    return { allowed: true, reason: "auto-approved", riskLevel };
  }

  if (mode === "trust") {
    return { allowed: true, reason: "trust-mode", riskLevel };
  }

  if (mode === "deny") {
    return { allowed: false, reason: "deny-mode", riskLevel };
  }

  if (mode === "plan") {
    if (isReadOnly) {
      return { allowed: true, reason: "plan-mode-readonly", riskLevel };
    }
    return { allowed: false, reason: "plan-mode-no-writes", riskLevel };
  }

  if (mode === "acceptEdits") {
    if (toolName && EDIT_SAFE_TOOLS.has(toolName)) {
      return { allowed: true, reason: "acceptEdits-auto", riskLevel };
    }
    return { allowed: false, reason: "needs-approval", riskLevel };
  }

  // ask mode — needs user approval
  return { allowed: false, reason: "needs-approval", riskLevel };
}
