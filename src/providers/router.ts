/**
 * Multi-Model Router — task-aware model selection.
 *
 * Routes LLM calls to the most appropriate model based on task context:
 * - Fast model for exploration, search, and tool-heavy turns
 * - Powerful model for final responses, code review, and complex reasoning
 * - Balanced model as the default
 *
 * Saves ~20% cost and ~30% latency by avoiding expensive models for simple tasks.
 */

export type ModelTier = "fast" | "balanced" | "powerful";

export type RouterConfig = {
  fast?: string; // e.g., "ollama/qwen2.5:7b"
  balanced?: string; // e.g., "gpt-4o-mini"
  powerful?: string; // e.g., "claude-sonnet-4-6"
};

export type RouteContext = {
  /** Current turn number (1-indexed) */
  turn: number;
  /** Whether the previous turn had tool calls */
  hadToolCalls: boolean;
  /** Number of tool calls in previous turn */
  toolCallCount: number;
  /** Agent role (if sub-agent) */
  role?: string;
  /** Estimated context usage (0-1) */
  contextUsage?: number;
  /** Whether this is likely the final response (no tool calls expected) */
  isFinalResponse?: boolean;
};

export type RouteResult = {
  model: string;
  tier: ModelTier;
  reason: string;
};

export class ModelRouter {
  private config: RouterConfig;
  private defaultModel: string;

  constructor(config: RouterConfig, defaultModel: string) {
    this.config = config;
    this.defaultModel = defaultModel;
  }

  /** Select the best model for the current context */
  select(context: RouteContext): RouteResult {
    // High-context pressure → use fast model to minimize token cost
    if (context.contextUsage && context.contextUsage > 0.8) {
      return this.route("fast", "context pressure > 80%");
    }

    // Roles that require deep reasoning → powerful
    const powerfulRoles = ["code-reviewer", "evaluator", "architect", "security-auditor"];
    if (context.role && powerfulRoles.includes(context.role)) {
      return this.route("powerful", `role: ${context.role}`);
    }

    // Early exploration turns (1-2) → fast
    if (context.turn <= 2 && context.hadToolCalls) {
      return this.route("fast", "early exploration");
    }

    // Tool-heavy turns (3+ tool calls) → fast (just dispatching)
    if (context.toolCallCount >= 3) {
      return this.route("fast", "tool-heavy turn");
    }

    // Final response (no tool calls) → powerful for quality
    if (context.isFinalResponse) {
      return this.route("powerful", "final response");
    }

    // Default → balanced
    return this.route("balanced", "default");
  }

  private route(tier: ModelTier, reason: string): RouteResult {
    const model = this.config[tier] ?? this.defaultModel;
    return { model, tier, reason };
  }

  /** Whether this router has any non-default models configured */
  get isConfigured(): boolean {
    return !!(this.config.fast || this.config.balanced || this.config.powerful);
  }

  /** Get all configured tiers */
  get tiers(): Record<ModelTier, string> {
    return {
      fast: this.config.fast ?? this.defaultModel,
      balanced: this.config.balanced ?? this.defaultModel,
      powerful: this.config.powerful ?? this.defaultModel,
    };
  }
}

const ROUTE_SELECTION_CAP = 256;
const routeSelections = new Map<string, RouteResult>();

/** Record the router's selection for a session. Keeps only the most recent 256 sessions. */
export function recordRouteSelection(sessionId: string, result: RouteResult): void {
  // Map preserves insertion order. Delete-then-set moves the key to the end,
  // so oldest is always keys().next().
  if (routeSelections.has(sessionId)) routeSelections.delete(sessionId);
  routeSelections.set(sessionId, result);
  if (routeSelections.size > ROUTE_SELECTION_CAP) {
    const oldest = routeSelections.keys().next().value;
    if (oldest !== undefined) routeSelections.delete(oldest);
  }
}

/** Retrieve the most recent selection for a session, or undefined. */
export function getRouteSelection(sessionId: string): RouteResult | undefined {
  return routeSelections.get(sessionId);
}
