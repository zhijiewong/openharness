/**
 * Meta-Harness — self-optimizing agent harness.
 *
 * Inspired by AutoAgent (which hit #1 on SpreadsheetBench by letting
 * the agent optimize its own harness overnight).
 *
 * Flow:
 * 1. Run benchmark → get baseline score
 * 2. Ask LLM to suggest a config change
 * 3. Apply change → re-run benchmark
 * 4. If score improved, keep; otherwise revert
 * 5. Repeat for N iterations
 *
 * What it optimizes:
 * - System prompt (trim, rephrase, add instructions)
 * - Tool selection (which tools are core vs deferred)
 * - Model router configuration
 * - Compression strategy
 * - Permission rules
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { invalidateConfigCache, type OhConfig, readOhConfig, writeOhConfig } from "../harness/config.js";
import type { Provider } from "../providers/base.js";

// ── Types ──

export type BenchmarkResult = {
  score: number; // 0-1
  details: string;
  durationMs: number;
};

export type OptimizationChange = {
  description: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  impact: number; // score delta
};

export type OptimizationResult = {
  initialScore: number;
  finalScore: number;
  iterations: number;
  changes: OptimizationChange[];
  totalDurationMs: number;
};

// ── Benchmark Runner ──

/**
 * Run a benchmark command and extract a score.
 * Score is derived from test results: pass_rate + speed_bonus.
 */
export async function runBenchmark(command: string): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 300_000, // 5 minute max
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse test results to extract score
    const score = extractScore(output);
    return {
      score,
      details: output.slice(-500),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = String(err.stdout ?? err.stderr ?? err.message ?? "");
    const score = extractScore(output);
    return {
      score: score > 0 ? score * 0.5 : 0, // Penalty for non-zero exit
      details: output.slice(-500),
      durationMs: Date.now() - start,
    };
  }
}

/** Extract a 0-1 score from test output */
function extractScore(output: string): number {
  // Look for common test result patterns
  // "X passed, Y failed" → pass_rate
  const passMatch = output.match(/(\d+)\s+pass/i);
  const failMatch = output.match(/(\d+)\s+fail/i);

  if (passMatch) {
    const passed = parseInt(passMatch[1]!, 10);
    const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;
    const total = passed + failed;
    return total > 0 ? passed / total : 0;
  }

  // "# pass N" (TAP format)
  const tapPass = output.match(/# pass\s+(\d+)/);
  const tapFail = output.match(/# fail\s+(\d+)/);
  if (tapPass) {
    const passed = parseInt(tapPass[1]!, 10);
    const failed = tapFail ? parseInt(tapFail[1]!, 10) : 0;
    const total = passed + failed;
    return total > 0 ? passed / total : 0;
  }

  // Exit code 0 = 1.0, non-zero = 0
  return output.includes("error") || output.includes("FAIL") ? 0.3 : 0.8;
}

// ── Meta-Harness ──

export class MetaHarness {
  constructor(
    private provider: Provider,
    private benchmarkCommand: string,
    private model?: string,
  ) {}

  /**
   * Run the optimization loop.
   */
  async optimize(iterations: number): Promise<OptimizationResult> {
    const totalStart = Date.now();
    const changes: OptimizationChange[] = [];

    // Backup current config
    const configPath = join(".oh", "config.yaml");
    const backupPath = join(".oh", "config.yaml.backup");
    if (existsSync(configPath)) {
      copyFileSync(configPath, backupPath);
    }

    // Get baseline score
    const baseline = await runBenchmark(this.benchmarkCommand);
    let bestScore = baseline.score;

    for (let i = 0; i < iterations; i++) {
      // Ask LLM to suggest an optimization
      const suggestion = await this.suggestChange(bestScore, changes);
      if (!suggestion) continue;

      // Apply the change
      this.applyChange(suggestion);

      // Re-benchmark
      const result = await runBenchmark(this.benchmarkCommand);

      if (result.score > bestScore) {
        // Keep the change
        const impact = result.score - bestScore;
        changes.push({ ...suggestion, impact });
        bestScore = result.score;
      } else {
        // Revert
        this.revertChange(suggestion);
      }
    }

    return {
      initialScore: baseline.score,
      finalScore: bestScore,
      iterations,
      changes,
      totalDurationMs: Date.now() - totalStart,
    };
  }

  private async suggestChange(
    currentScore: number,
    previousChanges: OptimizationChange[],
  ): Promise<Omit<OptimizationChange, "impact"> | null> {
    const config = readOhConfig();
    const configStr = JSON.stringify(config, null, 2);
    const prevChangesStr =
      previousChanges.length > 0
        ? `\nPrevious successful changes:\n${previousChanges.map((c) => `- ${c.description} (+${c.impact.toFixed(3)})`).join("\n")}`
        : "";

    const prompt = `You are optimizing an AI agent harness configuration. Current score: ${currentScore.toFixed(3)}/1.0.
${prevChangesStr}

Current config:
${configStr.slice(0, 2000)}

Suggest ONE specific configuration change that might improve the benchmark score. Focus on:
- System prompt optimization
- Tool selection (which tools are core)
- Permission rules that speed up automation
- Verification configuration

Respond with JSON: {"description": "what to change", "field": "config.path", "newValue": "the new value"}`;

    try {
      const response = await this.provider.complete(
        [{ role: "user", content: prompt, uuid: `meta-${Date.now()}`, timestamp: Date.now() }],
        "You are a harness optimization engine. Respond ONLY with valid JSON.",
        undefined,
        this.model,
      );

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description ?? "unknown change",
        field: parsed.field ?? "unknown",
        oldValue: undefined,
        newValue: parsed.newValue,
      };
    } catch {
      return null;
    }
  }

  private applyChange(change: Omit<OptimizationChange, "impact">): void {
    invalidateConfigCache();
    // Apply change to config by reading, modifying, and writing back
    const config = readOhConfig() ?? ({} as OhConfig);
    try {
      // Simple top-level field update (nested paths would need lodash.set)
      const field = change.field.replace(/^config\./, "");
      (config as any)[field] = change.newValue;
      writeOhConfig(config);
    } catch {
      /* revert will handle failures */
    }
  }

  private revertChange(_change: Omit<OptimizationChange, "impact">): void {
    invalidateConfigCache();
    // Revert by re-reading the backup config
    const backupPath = join(".oh", "config.yaml.backup");
    const configPath = join(".oh", "config.yaml");
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, configPath);
      invalidateConfigCache();
    }
  }
}

/** Format optimization results for display */
export function formatOptimizationResult(result: OptimizationResult): string {
  const lines: string[] = [];
  const improvement = result.finalScore - result.initialScore;
  const pct = result.initialScore > 0 ? ((improvement / result.initialScore) * 100).toFixed(1) : "0";

  lines.push(`Meta-Harness Optimization Complete`);
  lines.push(`${"─".repeat(40)}`);
  lines.push(`Initial score: ${result.initialScore.toFixed(3)}`);
  lines.push(`Final score:   ${result.finalScore.toFixed(3)} (${improvement >= 0 ? "+" : ""}${pct}%)`);
  lines.push(`Iterations:    ${result.iterations}`);
  lines.push(`Duration:      ${Math.round(result.totalDurationMs / 1000)}s`);

  if (result.changes.length > 0) {
    lines.push("");
    lines.push("Applied changes:");
    for (const c of result.changes) {
      lines.push(`  +${c.impact.toFixed(3)} ${c.description}`);
    }
  } else {
    lines.push("");
    lines.push("No improvements found in this run.");
  }

  return lines.join("\n");
}
