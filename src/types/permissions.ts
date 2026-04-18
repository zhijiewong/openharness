/**
 * Permission types — tool permission context and risk-based gating.
 */

import type { ToolPermissionRule } from "../harness/config.js";
import {
  analyzeBashCommand,
  isReadOnlyBashCommand,
  splitCommands,
  stripProcessWrappers,
} from "../utils/bash-safety.js";

export type PermissionMode = "ask" | "trust" | "deny" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";

export type RiskLevel = "low" | "medium" | "high";

export type PermissionResult = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly riskLevel: RiskLevel;
};

export type AskUserFn = (toolName: string, description: string, riskLevel?: RiskLevel) => Promise<boolean>;

/** Tools auto-approved in acceptEdits mode */
const EDIT_SAFE_TOOLS = new Set([
  "FileRead",
  "FileWrite",
  "FileEdit",
  "Glob",
  "Grep",
  "LS",
  "ImageRead",
  "NotebookEdit",
]);

/** Parse a tool specifier like "Bash(npm run *)" into tool name + pattern */
function parseToolSpecifier(specifier: string): { toolName: string; argPattern?: string } {
  const match = specifier.match(/^(\w+)\((.+)\)$/);
  if (match) return { toolName: match[1]!, argPattern: match[2]! };
  return { toolName: specifier };
}

/** Match a tool name against a pattern (supports trailing * for prefix matching) */
function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return pattern === toolName;
}

/**
 * Match an argument pattern against a value using glob-style matching.
 * Supports: * (any chars), ** (any path segments)
 */
function matchArgGlob(pattern: string, value: string): boolean {
  // Convert glob to regex: * → [^/]*, ** → .*, escape other regex chars
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars (except * and ?)
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");
  try {
    return new RegExp(`^${regexStr}$`).test(value);
  } catch {
    return false;
  }
}

/** Find the first matching tool permission rule */
/**
 * Priority of a rule action for "most restrictive wins" tie-breaking across
 * subcommand matches: deny > ask > allow. Rules that don't apply return -1.
 */
function actionPriority(action: ToolPermissionRule["action"]): number {
  return action === "deny" ? 2 : action === "ask" ? 1 : 0;
}

function matchesSingleRule(r: ToolPermissionRule, toolName: string, toolInput?: unknown): boolean {
  const { toolName: specToolName, argPattern } = parseToolSpecifier(r.tool);
  if (!matchToolPattern(specToolName, toolName)) return false;

  if (argPattern && toolInput) {
    const input = toolInput as Record<string, unknown>;
    if (toolName === "Bash" && typeof input.command === "string") {
      return matchArgGlob(argPattern, input.command);
    }
    if (["Edit", "Write", "Read"].includes(toolName) && typeof input.file_path === "string") {
      return matchArgGlob(argPattern, input.file_path);
    }
    return false;
  }

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
}

/**
 * Match permission rules against a Bash command.
 *
 * For compound commands (`cmd1 && cmd2`, `a | b`, `x; y`), evaluate rules
 * against each sub-command independently with "most restrictive wins"
 * semantics: any sub-command matching a `deny` rule returns deny; else any
 * `ask` match returns ask; else any `allow` match returns allow; else no
 * match. Process wrappers (`timeout 10 cmd`, `nice -n 5 cmd`) are stripped
 * before matching so the real underlying command is what gets checked.
 *
 * Security note: this closes a common class of bypasses like
 * `git log && rm -rf /` where a naive full-line match would hit the `git log`
 * allow rule and skip the deny on `rm`.
 */
function findBashRule(rules: ToolPermissionRule[], command: string): ToolPermissionRule | undefined {
  const subs = splitCommands(command).map(stripProcessWrappers).filter(Boolean);
  if (subs.length === 0) return undefined;

  let best: ToolPermissionRule | undefined;
  let bestPriority = -1;
  for (const sub of subs) {
    const subInput = { command: sub };
    for (const r of rules) {
      if (!matchesSingleRule(r, "Bash", subInput)) continue;
      const p = actionPriority(r.action);
      if (p > bestPriority) {
        best = r;
        bestPriority = p;
        if (p === 2) return best; // deny short-circuits
      }
    }
  }
  return best;
}

function findToolRule(
  rules: ToolPermissionRule[] | undefined,
  toolName: string,
  toolInput?: unknown,
): ToolPermissionRule | undefined {
  if (!rules || rules.length === 0) return undefined;

  // Bash: always route through the compound-aware matcher. For single commands
  // this just strips wrappers and does a normal rule search; for compound
  // commands it evaluates each sub-command with most-restrictive-wins.
  if (toolName === "Bash" && toolInput) {
    const command = (toolInput as Record<string, unknown>)?.command;
    if (typeof command === "string") {
      const compoundMatch = findBashRule(rules, command);
      if (compoundMatch) return compoundMatch;
      // Compound matcher returned nothing (single command or no match).
      // Fall through to the default single-rule find below.
    }
  }

  return rules.find((r) => matchesSingleRule(r, toolName, toolInput));
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
  let bashReadOnly = false;
  if (toolName === "Bash" && toolInput) {
    const command = (toolInput as Record<string, unknown>)?.command;
    if (typeof command === "string") {
      // Read-only allowlist short-circuit (Claude Code parity). A pure
      // inspection pipeline like `ls | head` or `git status` should not
      // prompt the user in any permission mode that gates read-only work.
      if (isReadOnlyBashCommand(command)) {
        bashReadOnly = true;
        effectiveRisk = "low";
      } else {
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
  }

  // Always allow low-risk read-only (now includes Bash commands matching the allowlist)
  if (effectiveRisk === "low" && (isReadOnly || bashReadOnly)) {
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
