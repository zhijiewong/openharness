/**
 * Verification loops — auto-run lint/typecheck after file edits.
 *
 * After file-modifying tools (Edit, Write, MultiEdit) execute,
 * runs language-appropriate verification commands and returns
 * concise results to feed back into the agent loop.
 *
 * This is the single highest-impact harness engineering pattern —
 * research shows 2-3x quality improvement from automated feedback.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { readOhConfig } from "./config.js";

// ── Types ──

export type VerificationRule = {
  extensions: string[]; // e.g. [".ts", ".tsx"]
  lint?: string; // shell command; {file} replaced with path
  timeout?: number; // ms, default 10000
};

export type VerificationConfig = {
  enabled: boolean;
  mode: "warn" | "block"; // warn = append to output, block = mark isError
  rules: VerificationRule[];
};

export type VerificationResult = {
  ran: boolean;
  passed: boolean;
  summary: string; // max 500 chars
};

const MAX_SUMMARY_CHARS = 500;
const DEFAULT_TIMEOUT_MS = 10_000;

// ── Auto-detection ──

/** Detect verification rules from project files */
export function autoDetectRules(projectRoot?: string): VerificationRule[] {
  const root = projectRoot ?? process.cwd();
  const rules: VerificationRule[] = [];

  // TypeScript
  if (existsSync(join(root, "tsconfig.json"))) {
    rules.push({
      extensions: [".ts", ".tsx"],
      lint: "npx tsc --noEmit 2>&1 | head -20",
      timeout: 15_000,
    });
  }

  // ESLint (JS/TS)
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
  ];
  if (eslintConfigs.some((f) => existsSync(join(root, f)))) {
    rules.push({
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      lint: "npx eslint {file} --no-color 2>&1 | head -15",
      timeout: 10_000,
    });
  }

  // Python — ruff (fast) or pylint
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "setup.py"))) {
    rules.push({
      extensions: [".py"],
      lint: "ruff check {file} 2>&1 | head -10",
      timeout: 10_000,
    });
  }

  // Go
  if (existsSync(join(root, "go.mod"))) {
    rules.push({
      extensions: [".go"],
      lint: "go vet ./... 2>&1 | head -10",
      timeout: 15_000,
    });
  }

  // Rust
  if (existsSync(join(root, "Cargo.toml"))) {
    rules.push({
      extensions: [".rs"],
      lint: "cargo check 2>&1 | tail -10",
      timeout: 30_000,
    });
  }

  return rules;
}

// ── Config ──

let _cachedConfig: VerificationConfig | null | undefined;

/** Get verification config from .oh/config.yaml or auto-detect */
export function getVerificationConfig(): VerificationConfig | null {
  if (_cachedConfig !== undefined) return _cachedConfig;

  const ohConfig = readOhConfig();

  if (ohConfig?.verification) {
    const v = ohConfig.verification;
    // Explicitly disabled
    if (v.enabled === false) {
      _cachedConfig = null;
      return null;
    }
    _cachedConfig = {
      enabled: true,
      mode: v.mode ?? "warn",
      rules: v.rules ?? autoDetectRules(),
    };
    return _cachedConfig;
  }

  // Auto-detect if no config
  const autoRules = autoDetectRules();
  if (autoRules.length === 0) {
    _cachedConfig = null;
    return null;
  }

  _cachedConfig = { enabled: true, mode: "warn", rules: autoRules };
  return _cachedConfig;
}

/** Clear cached config (for testing or after config changes) */
export function invalidateVerificationCache(): void {
  _cachedConfig = undefined;
}

// ── File path extraction ──

/** Extract file paths from tool input that were modified */
export function extractFilePaths(toolName: string, toolInput: Record<string, unknown>): string[] {
  switch (toolName) {
    case "Write":
    case "Edit":
      return toolInput.file_path ? [String(toolInput.file_path)] : [];
    case "MultiEdit":
      // MultiEdit has an array of edits, each with file_path
      if (Array.isArray(toolInput.edits)) {
        const paths = new Set<string>();
        for (const edit of toolInput.edits) {
          if (edit && typeof edit === "object" && "file_path" in edit) {
            paths.add(String(edit.file_path));
          }
        }
        return [...paths];
      }
      return toolInput.file_path ? [String(toolInput.file_path)] : [];
    default:
      return [];
  }
}

// ── Verification execution ──

/** Find the matching rule for a file extension */
function findRule(filePath: string, rules: VerificationRule[]): VerificationRule | null {
  const ext = extname(filePath).toLowerCase();
  return rules.find((r) => r.extensions.includes(ext)) ?? null;
}

/**
 * Shell-escape a file path to prevent command injection.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
function shellEscape(s: string): string {
  // On Windows, use double quotes; on POSIX, use single quotes
  if (process.platform === "win32") {
    // Double-quote and escape internal double quotes and special chars
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  // POSIX: single-quote and escape embedded single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Run verification for multiple files. Aggregates results.
 * Returns a single result summarizing all files checked.
 */
export async function runVerificationForFiles(
  filePaths: string[],
  config: VerificationConfig,
): Promise<VerificationResult> {
  if (filePaths.length === 0) return { ran: false, passed: true, summary: "" };
  if (filePaths.length === 1) return runVerification(filePaths[0]!, config);

  const results: VerificationResult[] = [];
  for (const fp of filePaths) {
    results.push(await runVerification(fp, config));
  }

  const ran = results.some((r) => r.ran);
  const passed = results.every((r) => r.passed);
  const failures = results.filter((r) => r.ran && !r.passed);

  if (!ran) return { ran: false, passed: true, summary: "" };
  if (passed) return { ran: true, passed: true, summary: "" };

  // Aggregate failure summaries (cap total to MAX_SUMMARY_CHARS)
  const summaryParts = failures.map((r) => r.summary).filter(Boolean);
  const summary = summaryParts.join("\n---\n").slice(0, MAX_SUMMARY_CHARS);
  return { ran: true, passed: false, summary };
}

/** Run verification for a single file. Returns result with concise summary. */
export async function runVerification(filePath: string, config: VerificationConfig): Promise<VerificationResult> {
  const rule = findRule(filePath, config.rules);
  if (!rule?.lint) {
    return { ran: false, passed: true, summary: "" };
  }

  const command = rule.lint.replace(/\{file\}/g, shellEscape(filePath));
  const timeout = rule.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    execSync(command, {
      timeout,
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    // Exit code 0 = passed
    return { ran: true, passed: true, summary: "" };
  } catch (err: any) {
    // Timeout detection — check killed flag, signal, or error code
    const isTimeout =
      err.killed || err.signal === "SIGTERM" || err.code === "ETIMEDOUT" || (err.status === null && err.signal);
    if (isTimeout) {
      return { ran: true, passed: false, summary: `Verification timed out after ${timeout / 1000}s` };
    }

    const output = String(err.stdout ?? err.stderr ?? err.message ?? "Unknown error");
    const summary = output.slice(0, MAX_SUMMARY_CHARS).trim();
    return { ran: true, passed: false, summary };
  }
}
