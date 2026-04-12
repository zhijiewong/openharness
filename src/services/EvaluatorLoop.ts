/**
 * GAN-Style Evaluator Loop — Generator→Evaluator adversarial refinement.
 *
 * Inspired by Anthropic's three-agent harness architecture:
 * "AI models are inherently poor at self-critique; they tend to rate
 * their own work favorably." Externalizing critique to a separate
 * Evaluator agent produces measurably better output.
 *
 * Flow:
 * 1. Generator produces initial output
 * 2. Evaluator scores against rubric criteria
 * 3. If below threshold, Generator refines based on feedback
 * 4. Repeat until pass or max iterations reached
 */

import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";

// ── Types ──

export type EvaluationCriterion = {
  name: string; // "correctness", "code_quality", "test_coverage"
  weight: number; // 0-1, must sum to 1
  description: string; // what the evaluator checks for
};

export type EvaluationRubric = {
  criteria: EvaluationCriterion[];
  passThreshold: number; // 0-1, minimum weighted score
};

export type EvaluationScore = {
  criterion: string;
  score: number; // 0-1
  feedback: string;
};

export type EvaluatorResult = {
  output: string;
  scores: EvaluationScore[];
  weightedScore: number;
  passed: boolean;
  iterations: number;
  refinements: string[];
};

// ── Default Rubric ──

export const DEFAULT_RUBRIC: EvaluationRubric = {
  criteria: [
    {
      name: "correctness",
      weight: 0.4,
      description: "Does the output correctly address the task? Are there logical errors?",
    },
    {
      name: "completeness",
      weight: 0.3,
      description: "Is the solution complete? Any missing edge cases or requirements?",
    },
    { name: "quality", weight: 0.2, description: "Is the code clean, well-structured, and following best practices?" },
    { name: "safety", weight: 0.1, description: "Are there security issues, unsafe patterns, or potential bugs?" },
  ],
  passThreshold: 0.7,
};

// ── Evaluator Loop ──

export class EvaluatorLoop {
  constructor(
    private provider: Provider,
    private tools: Tools,
    private systemPrompt: string,
    private permissionMode: PermissionMode,
    private model?: string,
    private rubric: EvaluationRubric = DEFAULT_RUBRIC,
    private maxIterations: number = 3,
  ) {}

  /**
   * Run the full Generator→Evaluator→Refine cycle.
   */
  async run(task: string): Promise<EvaluatorResult> {
    const refinements: string[] = [];
    let currentOutput = "";
    let scores: EvaluationScore[] = [];
    let weightedScore = 0;

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      // ── Generate ──
      const generatorPrompt =
        iteration === 1
          ? task
          : `${task}\n\n[Evaluator feedback from iteration ${iteration - 1}]:\n${scores.map((s) => `${s.criterion}: ${s.score}/1.0 — ${s.feedback}`).join("\n")}\n\nPlease refine your output based on this feedback.`;

      currentOutput = await this.generate(generatorPrompt);

      // ── Evaluate ──
      scores = await this.evaluate(task, currentOutput);
      weightedScore = this.calculateWeightedScore(scores);

      if (weightedScore >= this.rubric.passThreshold) {
        return {
          output: currentOutput,
          scores,
          weightedScore,
          passed: true,
          iterations: iteration,
          refinements,
        };
      }

      refinements.push(`Iteration ${iteration}: score ${weightedScore.toFixed(2)} — refining`);
    }

    // Max iterations reached — return best effort
    return {
      output: currentOutput,
      scores,
      weightedScore,
      passed: false,
      iterations: this.maxIterations,
      refinements,
    };
  }

  private async generate(prompt: string): Promise<string> {
    const { query } = await import("../query.js");
    const config = {
      provider: this.provider,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      permissionMode: this.permissionMode,
      model: this.model,
      maxTurns: 15,
    };

    let output = "";
    for await (const event of query(prompt, config)) {
      if (event.type === "text_delta") output += (event as any).content;
    }
    return output;
  }

  private async evaluate(task: string, output: string): Promise<EvaluationScore[]> {
    const evaluationPrompt = `You are a code evaluator. Score the following output on a 0-1 scale for each criterion.

Task: ${task.slice(0, 500)}

Output to evaluate:
${output.slice(0, 3000)}

Criteria:
${this.rubric.criteria.map((c) => `- ${c.name} (weight: ${c.weight}): ${c.description}`).join("\n")}

Respond ONLY with a JSON array: [{"criterion": "name", "score": 0.8, "feedback": "brief explanation"}, ...]`;

    const response = await this.provider.complete(
      [{ role: "user", content: evaluationPrompt, uuid: `eval-${Date.now()}`, timestamp: Date.now() }],
      "You are a strict code evaluator. Respond ONLY with valid JSON. Be critical and specific.",
      undefined,
      this.model,
    );

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.defaultScores();
      const parsed = JSON.parse(jsonMatch[0]) as EvaluationScore[];
      return parsed.filter((s) => s.criterion && typeof s.score === "number");
    } catch {
      return this.defaultScores();
    }
  }

  private calculateWeightedScore(scores: EvaluationScore[]): number {
    let total = 0;
    for (const criterion of this.rubric.criteria) {
      const score = scores.find((s) => s.criterion === criterion.name);
      total += (score?.score ?? 0.5) * criterion.weight;
    }
    return total;
  }

  private defaultScores(): EvaluationScore[] {
    return this.rubric.criteria.map((c) => ({
      criterion: c.name,
      score: 0.5,
      feedback: "Could not evaluate (parsing error)",
    }));
  }
}

/** Format evaluator results for display */
export function formatEvaluatorResult(result: EvaluatorResult): string {
  const lines: string[] = [];
  lines.push(
    `Evaluator: ${result.passed ? "PASSED" : "NEEDS IMPROVEMENT"} (${result.weightedScore.toFixed(2)}/${1.0})`,
  );
  lines.push(`Iterations: ${result.iterations}`);
  lines.push("");
  for (const s of result.scores) {
    const bar = "█".repeat(Math.round(s.score * 10)) + "░".repeat(10 - Math.round(s.score * 10));
    lines.push(`  ${s.criterion.padEnd(15)} ${bar} ${s.score.toFixed(1)} — ${s.feedback}`);
  }
  if (result.refinements.length > 0) {
    lines.push("");
    lines.push("Refinements:");
    for (const r of result.refinements) lines.push(`  ${r}`);
  }
  return lines.join("\n");
}
