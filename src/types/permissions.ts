/**
 * Permission types — tool permission context and risk-based gating.
 */

import type { ToolPermissionRule } from "../harness/config.js";
import { analyzeBashCommand } from "../utils/bash-safety.js";

export type PermissionMode = "ask" | "trust" | "deny" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";

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
function findToolRule(rules: ToolPermissionRule[] | undefined, toolName: string, toolInput?: unknown): ToolPermissionRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  return rules.find(r => {
    if (!matchToolPattern(r.tool, toolName)) return false;
    // If rule has a pattern, match against Bash command content only
    if (r.pattern && toolInput && toolName === "Bash") {
      const command = (toolInput as Record<string, unknown>)?.command;
      if (typeof command === "string") {
        try {
          return new RegExp(r.pattern).test(command);
        } catch {
          return false;
        }
      }
      return false;
    }
    return true;
  });
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
  toolInput?: unknown,
): PermissionResult {
  // Check per-tool permission rules first (highest priority)
  if (toolName) {
    const rule = findToolRule(toolPermissionRules, toolName, toolInput);
    if (rule) {
      if (rule.action === "allow") return { allowed: true, reason: "tool-rule-allow", riskLevel };
      if (rule.action === "deny") return { allowed: false, reason: "tool-rule-deny", riskLevel };
      if (rule.action === "ask") return { allowed: false, reason: "needs-approval", riskLevel };
    }
  }

  // Bash command safety analysis — detect destructive patterns
  let effectiveRisk = riskLevel;
  if (toolName === "Bash" && toolInput) {
    const command = (toolInput as Record<string, unknown>)?.command;
    if (typeof command === "string") {
      const analysis = analyzeBashCommand(command);
      if (analysis.level === "dangerous") {
        effectiveRisk = "high";
      } else if (analysis.level === "moderate" && effectiveRisk !== "high") {
        effectiveRisk = "medium";
      } else if (analysis.level === "safe") {
        effectiveRisk = "medium"; // bash is never fully "low" risk
      }
    }
  }

  // Always allow low-risk read-only
  if (effectiveRisk === "low" && isReadOnly) {
    return { allowed: true, reason: "auto-approved", riskLevel: effectiveRisk };
  }

  // bypassPermissions — approve everything unconditionally (CI/testing only)
  if (mode === "bypassPermissions") {
    return { allowed: true, reason: "bypass-mode", riskLevel: effectiveRisk };
  }

  // auto — approve everything EXCEPT dangerous bash commands (detected by AST analysis)
  if (mode === "auto") {
    if (effectiveRisk === "high" && toolName === "Bash") {
      return { allowed: false, reason: "auto-mode-dangerous-bash", riskLevel: effectiveRisk };
    }
    return { allowed: true, reason: "auto-mode", riskLevel: effectiveRisk };
  }

  if (mode === "trust") {
    return { allowed: true, reason: "trust-mode", riskLevel: effectiveRisk };
  }

  if (mode === "deny") {
    return { allowed: false, reason: "deny-mode", riskLevel: effectiveRisk };
  }

  if (mode === "plan") {
    if (isReadOnly) {
      return { allowed: true, reason: "plan-mode-readonly", riskLevel: effectiveRisk };
    }
    return { allowed: false, reason: "plan-mode-no-writes", riskLevel: effectiveRisk };
  }

  if (mode === "acceptEdits") {
    if (toolName && EDIT_SAFE_TOOLS.has(toolName)) {
      return { allowed: true, reason: "acceptEdits-auto", riskLevel: effectiveRisk };
    }
    return { allowed: false, reason: "needs-approval", riskLevel: effectiveRisk };
  }

  // ask mode — needs user approval
  return { allowed: false, reason: "needs-approval", riskLevel: effectiveRisk };
}
