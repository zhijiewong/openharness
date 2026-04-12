/**
 * openHarness Agent SDK — programmatic API for building AI agents.
 *
 * Usage:
 *   import { createAgent } from '@zhijiewang/openharness';
 *
 *   const agent = createAgent({
 *     provider: 'anthropic',
 *     model: 'claude-sonnet-4-6',
 *     apiKey: process.env.ANTHROPIC_API_KEY,
 *   });
 *
 *   const result = await agent.run('Fix the failing tests');
 *   console.log(result.text);
 */

import type { Provider } from "../providers/base.js";
import type { Tools } from "../Tool.js";
import type { StreamEvent } from "../types/events.js";
import type { PermissionMode } from "../types/permissions.js";

// ── Types ──

export type AgentConfig = {
  /** Provider name: 'anthropic', 'openai', 'ollama', 'openrouter', etc. */
  provider: string;
  /** Model identifier */
  model: string;
  /** API key (or use environment variable) */
  apiKey?: string;
  /** Custom base URL */
  baseUrl?: string;
  /** Tools to include: 'all', 'read-only', or array of tool names */
  tools?: "all" | "read-only" | string[];
  /** Permission mode (default: 'trust') */
  permissionMode?: PermissionMode;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Max turns per run */
  maxTurns?: number;
  /** Working directory */
  cwd?: string;
};

export type AgentResult = {
  /** Final text output */
  text: string;
  /** Tool calls made during execution */
  toolCalls: Array<{ toolName: string; output: string; isError: boolean }>;
  /** Total cost in USD */
  cost: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Number of turns taken */
  turns: number;
};

// ── Agent Class ──

export class Agent {
  private provider: Provider | null = null;
  private tools: Tools | null = null;
  private config: AgentConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: AgentConfig) {
    this.config = {
      permissionMode: "trust",
      maxTurns: 20,
      ...config,
    };
  }

  /** Initialize provider and tools (lazy, on first use). Race-safe via promise guard. */
  private init(): Promise<void> {
    return (this.initPromise ??= this._doInit());
  }

  private async _doInit(): Promise<void> {
    const { createProvider } = await import("../providers/index.js");
    const { getAllTools } = await import("../tools.js");

    const overrides: any = {};
    if (this.config.apiKey) overrides.apiKey = this.config.apiKey;
    if (this.config.baseUrl) overrides.baseUrl = this.config.baseUrl;

    const { provider } = await createProvider(
      this.config.model,
      Object.keys(overrides).length > 0 ? overrides : undefined,
    );
    this.provider = provider;

    // Filter tools
    let tools = getAllTools();
    if (this.config.tools === "read-only") {
      const readOnlyNames = new Set(["Read", "Glob", "Grep", "LS", "ImageRead", "WebSearch", "WebFetch"]);
      tools = tools.filter((t) => readOnlyNames.has(t.name));
    } else if (Array.isArray(this.config.tools)) {
      const allowed = new Set(this.config.tools.map((n) => n.toLowerCase()));
      tools = tools.filter((t) => allowed.has(t.name.toLowerCase()));
    }
    this.tools = tools;
  }

  /** Run a single prompt and return the result */
  async run(prompt: string): Promise<AgentResult> {
    await this.init();

    const { query } = await import("../query.js");

    const originalCwd = process.cwd();
    if (this.config.cwd) {
      try {
        process.chdir(this.config.cwd);
      } catch {
        /* ignore */
      }
    }

    const config = {
      provider: this.provider!,
      tools: this.tools!,
      systemPrompt: this.config.systemPrompt ?? "You are a helpful coding agent.",
      permissionMode: this.config.permissionMode!,
      model: this.config.model,
      maxTurns: this.config.maxTurns,
    };

    let text = "";
    const toolCalls: AgentResult["toolCalls"] = [];
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let turns = 0;

    try {
      for await (const event of query(prompt, config)) {
        switch (event.type) {
          case "text_delta":
            text += event.content;
            break;
          case "tool_call_end":
            toolCalls.push({
              toolName: event.callId,
              output: event.output,
              isError: event.isError,
            });
            break;
          case "cost_update":
            cost += event.cost;
            inputTokens += event.inputTokens;
            outputTokens += event.outputTokens;
            break;
          case "turn_complete":
            turns++;
            break;
        }
      }
    } finally {
      if (this.config.cwd) {
        try {
          process.chdir(originalCwd);
        } catch {
          /* ignore */
        }
      }
    }

    return { text, toolCalls, cost, inputTokens, outputTokens, turns };
  }

  /** Stream events from a prompt */
  async *stream(prompt: string): AsyncGenerator<StreamEvent, void> {
    await this.init();

    const { query } = await import("../query.js");

    if (this.config.cwd) {
      try {
        process.chdir(this.config.cwd);
      } catch {
        /* ignore */
      }
    }

    const config = {
      provider: this.provider!,
      tools: this.tools!,
      systemPrompt: this.config.systemPrompt ?? "You are a helpful coding agent.",
      permissionMode: this.config.permissionMode!,
      model: this.config.model,
      maxTurns: this.config.maxTurns,
    };

    yield* query(prompt, config);
  }

  /** Stop the agent (cleanup) */
  stop(): void {
    this.provider = null;
    this.tools = null;
    this.initPromise = null;
  }
}

// ── Factory ──

/** Create a new agent instance */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}

// Re-export types
export type { StreamEvent } from "../types/events.js";
export type { PermissionMode } from "../types/permissions.js";
