/**
 * Permission types — mirrors Claude Code's ToolPermissionContext.
 */

export type PermissionMode = "ask" | "trust" | "deny";

export type RiskLevel = "low" | "medium" | "high";

export type PermissionResult = {
  readonly allowed: boolean;
  readonly reason: string;
  readonly riskLevel: RiskLevel;
};

export type AskUserFn = (
  toolName: string,
  description: string,
) => Promise<boolean>;

/**
 * Permission gate — decides if a tool call should be allowed.
 *
 * Decision matrix (mirrors Claude Code):
 * - LOW risk + read-only: always allow
 * - trust mode: always allow
 * - deny mode: only allow LOW read-only
 * - ask mode: prompt user for MEDIUM/HIGH risk
 */
export function checkPermission(
  mode: PermissionMode,
  riskLevel: RiskLevel,
  isReadOnly: boolean,
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

  // ask mode — needs user approval (handled by caller)
  return { allowed: false, reason: "needs-approval", riskLevel };
}
