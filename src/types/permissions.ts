/**
 * Permission types — tool permission context and risk-based gating.
 */

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

export function checkPermission(
  mode: PermissionMode,
  riskLevel: RiskLevel,
  isReadOnly: boolean,
  toolName?: string,
): PermissionResult {
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
