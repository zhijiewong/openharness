/**
 * Integration test: verifies that the query() loop passes the ModelRouter-selected
 * model to provider.stream() on each turn.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { invalidateConfigCache } from "../harness/config.js";
import type { Provider } from "../providers/base.js";
import { makeTmpDir } from "../test-helpers.js";
import type { StreamEvent } from "../types/events.js";
import type { Message } from "../types/message.js";
import { query } from "./index.js";

// ── Fake provider that records the `model` arg per stream() call ──

function makeRecordingProvider(streamResponses: StreamEvent[][]): {
  provider: Provider;
  modelsUsed: string[];
} {
  const modelsUsed: string[] = [];
  let callIdx = 0;

  const provider = {
    name: "recording-mock",

    async *stream(_messages: Message[], _systemPrompt: string, _tools: unknown, model?: string) {
      modelsUsed.push(model ?? "<unset>");
      const events = streamResponses[callIdx++] ?? [];
      for (const e of events) yield e;
    },

    async complete(): Promise<Message> {
      return { role: "assistant", content: "" } as Message;
    },

    listModels() {
      return [];
    },

    async healthCheck() {
      return true;
    },

    estimateTokens(s: string) {
      return Math.ceil(s.length / 4);
    },

    getModelInfo(model: string) {
      return {
        id: model,
        provider: "recording-mock",
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        inputCostPerMtok: 0,
        outputCostPerMtok: 0,
      };
    },
  } as unknown as Provider;

  return { provider, modelsUsed };
}

// ── Write a minimal .oh/config.yaml in a temp dir and run fn() inside it ──

async function withRouterConfig(
  routerCfg: { fast?: string; balanced?: string; powerful?: string },
  fn: () => Promise<void>,
): Promise<void> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    mkdirSync(`${dir}/.oh`, { recursive: true });
    const lines = ["provider: mock", "model: DEFAULT", "permissionMode: trust"];
    if (Object.values(routerCfg).some(Boolean)) {
      lines.push("modelRouter:");
      if (routerCfg.fast) lines.push(`  fast: ${routerCfg.fast}`);
      if (routerCfg.balanced) lines.push(`  balanced: ${routerCfg.balanced}`);
      if (routerCfg.powerful) lines.push(`  powerful: ${routerCfg.powerful}`);
    }
    lines.push("");
    writeFileSync(`${dir}/.oh/config.yaml`, lines.join("\n"));
    invalidateConfigCache();
    await fn();
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

/** Drain a query generator to completion, ignoring yielded values. */
async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* ignore */
  }
}

// ── Minimal QueryConfig shape ──

type MinimalConfig = {
  provider: Provider;
  model: string;
  tools: [];
  systemPrompt: string;
  permissionMode: "trust";
  role?: string;
};

// ── Tests ──

describe("query — ModelRouter integration", () => {
  it("no router config → all stream() calls use config.model", async () => {
    await withRouterConfig({}, async () => {
      const { provider, modelsUsed } = makeRecordingProvider([
        [
          { type: "text_delta", content: "hi" } satisfies StreamEvent,
          // No tool calls → query() exits after first turn (turn_complete is yielded internally)
        ],
      ]);

      const gen = query(
        "hi",
        {
          provider,
          model: "DEFAULT",
          tools: [],
          systemPrompt: "",
          permissionMode: "trust",
        } as unknown as MinimalConfig,
        [{ role: "user", content: "hi" } as Message],
      );
      await drain(gen);

      assert.equal(modelsUsed.length, 1, "stream() should have been called once");
      assert.equal(modelsUsed[0], "DEFAULT", "unconfigured router must fall back to config.model");
    });
  });

  it("router configured → first turn with no previous tool calls uses 'balanced' tier", async () => {
    // Heuristic trace for turn 1, hadToolCalls=false, toolCallCount=0, short messages:
    //   contextUsage << 0.8 → skip fast
    //   no role → skip powerful-roles
    //   turn<=2 && hadToolCalls → false → skip fast
    //   toolCallCount<3 → skip fast
    //   isFinalResponse = (lastTurnHadTools===undefined) && (turn>1) = true && false → false → skip powerful
    //   → balanced ✓
    await withRouterConfig({ fast: "FAST", balanced: "BALANCED", powerful: "POWERFUL" }, async () => {
      const { provider, modelsUsed } = makeRecordingProvider([
        [{ type: "text_delta", content: "ok" } satisfies StreamEvent],
      ]);

      const gen = query(
        "hi",
        {
          provider,
          model: "DEFAULT",
          tools: [],
          systemPrompt: "",
          permissionMode: "trust",
        } as unknown as MinimalConfig,
        [{ role: "user", content: "hi" } as Message],
      );
      await drain(gen);

      assert.equal(modelsUsed.length, 1, "stream() should have been called once");
      assert.equal(
        modelsUsed[0],
        "BALANCED",
        `expected BALANCED on first turn with default heuristic; got ${modelsUsed[0]}`,
      );
    });
  });

  it("sub-agent role=code-reviewer → 'powerful' tier", async () => {
    // Heuristic: powerfulRoles includes "code-reviewer" → routes to powerful before any other check
    await withRouterConfig({ fast: "FAST", balanced: "BALANCED", powerful: "POWERFUL" }, async () => {
      const { provider, modelsUsed } = makeRecordingProvider([
        [{ type: "text_delta", content: "review complete" } satisfies StreamEvent],
      ]);

      const gen = query(
        "review this",
        {
          provider,
          model: "DEFAULT",
          tools: [],
          systemPrompt: "",
          permissionMode: "trust",
          role: "code-reviewer",
        } as unknown as MinimalConfig,
        [{ role: "user", content: "review this" } as Message],
      );
      await drain(gen);

      assert.equal(modelsUsed.length, 1, "stream() should have been called once");
      assert.equal(modelsUsed[0], "POWERFUL", `expected POWERFUL for code-reviewer role; got ${modelsUsed[0]}`);
    });
  });
});
