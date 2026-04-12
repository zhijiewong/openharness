/**
 * PipelineExecutor — declarative multi-step tool workflows.
 *
 * Executes a sequence of tool calls with dependency resolution and
 * variable substitution. Steps can reference prior step outputs via $stepId.
 *
 * Unlike the LLM-mediated agent loop, pipelines are deterministic —
 * faster, cheaper, and repeatable for known workflows.
 *
 * Reuses the dependency resolution pattern from AgentDispatcher.
 */

import type { ToolContext, ToolResult, Tools } from "../Tool.js";
import { findToolByName } from "../Tool.js";

// ── Types ──

export type PipelineStep = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
};

export type PipelineStepResult = {
  stepId: string;
  output: string;
  isError: boolean;
  durationMs: number;
};

type InternalStep = PipelineStep & {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: PipelineStepResult;
};

// ── Executor ──

export class PipelineExecutor {
  constructor(
    private tools: Tools,
    private context: ToolContext,
  ) {}

  /**
   * Execute a pipeline. Returns results for all steps.
   * Steps with unmet dependencies (failed/skipped blockers) are skipped.
   */
  async execute(steps: PipelineStep[]): Promise<PipelineStepResult[]> {
    // Validate step IDs are unique
    const ids = new Set(steps.map((s) => s.id));
    if (ids.size !== steps.length) {
      return [{ stepId: "pipeline", output: "Error: duplicate step IDs", isError: true, durationMs: 0 }];
    }

    const internal: Map<string, InternalStep> = new Map();
    for (const step of steps) {
      internal.set(step.id, { ...step, status: "pending" });
    }

    const results: PipelineStepResult[] = [];

    // Process steps in dependency order
    while (true) {
      const ready = [...internal.values()].filter((s) => s.status === "pending" && this.isReady(s, internal));
      const running = [...internal.values()].filter((s) => s.status === "running");

      if (ready.length === 0 && running.length === 0) break;

      // Execute ready steps (sequentially for safety — tools may have side effects)
      for (const step of ready) {
        step.status = "running";

        // Check if any blocker failed — skip this step
        if (this.hasFailedBlocker(step, internal)) {
          step.status = "skipped";
          const result: PipelineStepResult = {
            stepId: step.id,
            output: "Skipped: dependency failed",
            isError: true,
            durationMs: 0,
          };
          step.result = result;
          results.push(result);
          continue;
        }

        const result = await this.executeStep(step, internal);
        step.result = result;
        step.status = result.isError ? "failed" : "completed";
        results.push(result);
      }
    }

    return results;
  }

  private isReady(step: InternalStep, all: Map<string, InternalStep>): boolean {
    if (!step.dependsOn || step.dependsOn.length === 0) return true;
    return step.dependsOn.every((id) => {
      const dep = all.get(id);
      return dep && (dep.status === "completed" || dep.status === "failed" || dep.status === "skipped");
    });
  }

  private hasFailedBlocker(step: InternalStep, all: Map<string, InternalStep>): boolean {
    if (!step.dependsOn) return false;
    return step.dependsOn.some((id) => {
      const dep = all.get(id);
      return dep && (dep.status === "failed" || dep.status === "skipped");
    });
  }

  private async executeStep(step: InternalStep, all: Map<string, InternalStep>): Promise<PipelineStepResult> {
    const start = Date.now();

    // Find the tool
    const tool = findToolByName(this.tools, step.tool);
    if (!tool) {
      return {
        stepId: step.id,
        output: `Error: unknown tool '${step.tool}'`,
        isError: true,
        durationMs: Date.now() - start,
      };
    }

    // Substitute $refs in args
    const resolvedArgs = this.resolveArgs(step.args, all);

    // Validate and execute
    const parsed = tool.inputSchema.safeParse(resolvedArgs);
    if (!parsed.success) {
      return {
        stepId: step.id,
        output: `Validation error: ${parsed.error.message}`,
        isError: true,
        durationMs: Date.now() - start,
      };
    }

    try {
      const result: ToolResult = await tool.call(parsed.data, this.context);
      return {
        stepId: step.id,
        output: result.output,
        isError: result.isError,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        stepId: step.id,
        output: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Resolve $stepId references in args.
   * If a string value starts with $, replace it with the output of that step.
   * Supports nested objects and arrays.
   */
  private resolveArgs(args: Record<string, unknown>, all: Map<string, InternalStep>): Record<string, unknown> {
    const resolve = (value: unknown): unknown => {
      if (typeof value === "string" && value.startsWith("$")) {
        const refId = value.slice(1);
        const refStep = all.get(refId);
        if (refStep?.result && !refStep.result.isError) {
          return refStep.result.output;
        }
        return value; // Keep as-is if ref not found
      }
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === "object") {
        const resolved: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          resolved[k] = resolve(v);
        }
        return resolved;
      }
      return value;
    };

    return resolve(args) as Record<string, unknown>;
  }
}

/**
 * Format pipeline results as a readable summary.
 */
export function formatPipelineResults(results: PipelineStepResult[]): string {
  const lines: string[] = [];
  let totalMs = 0;

  for (const r of results) {
    const status = r.isError ? "✗" : "✓";
    const duration = r.durationMs > 0 ? ` (${r.durationMs}ms)` : "";
    lines.push(`${status} Step "${r.stepId}"${duration}`);

    // Show truncated output
    const output = r.output.length > 200 ? `${r.output.slice(0, 200)}...` : r.output;
    if (output) {
      for (const line of output.split("\n").slice(0, 5)) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
    totalMs += r.durationMs;
  }

  const passed = results.filter((r) => !r.isError).length;
  lines.push(`Pipeline: ${passed}/${results.length} steps passed (${totalMs}ms total)`);
  return lines.join("\n");
}
