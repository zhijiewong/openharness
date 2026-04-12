import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../Tool.js";

/** Prompt cache TTL in seconds (Anthropic's ephemeral cache) */
const CACHE_TTL = 300;

/** Maximum warm-cache delay — stay under TTL with margin */
const CACHE_WARM_MAX = 270;

const inputSchema = z.object({
  delaySeconds: z.number().describe("Seconds from now to wake up. Clamped to [60, 3600]."),
  reason: z.string().describe("One short sentence explaining the chosen delay. Shown to the user."),
  prompt: z
    .string()
    .describe(
      "The /loop prompt to fire on wake-up. Pass the same prompt each turn to continue the loop. Omit to end the loop.",
    ),
});

/**
 * Pending wakeup state — consumed by the REPL loop to schedule the next iteration.
 */
export type PendingWakeup = {
  delaySeconds: number;
  reason: string;
  prompt: string;
  scheduledAt: number;
};

let pendingWakeup: PendingWakeup | null = null;

/** Called by the REPL to check if a wakeup was scheduled */
export function consumeWakeup(): PendingWakeup | null {
  const w = pendingWakeup;
  pendingWakeup = null;
  return w;
}

/** Cancel any pending wakeup */
export function cancelWakeup(): void {
  pendingWakeup = null;
}

/** Check if there's a pending wakeup without consuming it */
export function hasPendingWakeup(): boolean {
  return pendingWakeup !== null;
}

/**
 * Suggest an optimal delay based on what you're waiting for.
 * Returns a delay in seconds that respects cache TTL boundaries.
 *
 * @param estimatedWaitSeconds - How long you think the thing will take
 * @param isIdle - True if there's nothing specific to check, just periodic polling
 * @returns Recommended delay in seconds
 */
export function suggestDelay(estimatedWaitSeconds: number, isIdle = false): number {
  if (isIdle) {
    // Idle polling: 20-30 min range. One cache miss, long amortization.
    return 1200;
  }

  if (estimatedWaitSeconds <= CACHE_WARM_MAX) {
    // Short wait: stay in cache window. Round up to at least 60s.
    return Math.max(60, Math.min(CACHE_WARM_MAX, Math.round(estimatedWaitSeconds)));
  }

  if (estimatedWaitSeconds <= CACHE_TTL) {
    // Awkward zone: would barely miss cache. Drop to warm max.
    return CACHE_WARM_MAX;
  }

  if (estimatedWaitSeconds <= 600) {
    // 5-10 min: commit to the cache miss, wait the full estimated time.
    return Math.round(estimatedWaitSeconds);
  }

  // Longer waits: cap at estimated time, but don't exceed 3600.
  return Math.min(3600, Math.round(estimatedWaitSeconds));
}

/**
 * Classify a delay into a cache-awareness category.
 */
function classifyDelay(delay: number): { zone: "warm" | "boundary" | "cold"; note: string } {
  if (delay <= CACHE_WARM_MAX) {
    return { zone: "warm", note: "prompt cache stays warm" };
  }
  if (delay > CACHE_WARM_MAX && delay <= CACHE_TTL + 30) {
    return {
      zone: "boundary",
      note: `~5min cache TTL boundary — consider ${CACHE_WARM_MAX}s (warm) or 1200s+ (amortized cold)`,
    };
  }
  const missCount = Math.floor(delay / CACHE_TTL);
  return { zone: "cold", note: `cache miss expected (${missCount > 1 ? `${missCount} windows` : "once"})` };
}

export const ScheduleWakeupTool: Tool<typeof inputSchema> = {
  name: "ScheduleWakeup",
  description:
    "Schedule when to resume work in /loop dynamic mode. The model self-paces iterations of a recurring task.",
  inputSchema,
  riskLevel: "low",

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return true;
  },

  async call(input, _context: ToolContext): Promise<ToolResult> {
    // Clamp delay to [60, 3600]
    const delay = Math.max(60, Math.min(3600, Math.round(input.delaySeconds)));

    pendingWakeup = {
      delaySeconds: delay,
      reason: input.reason,
      prompt: input.prompt,
      scheduledAt: Date.now(),
    };

    const { zone, note } = classifyDelay(delay);
    const icon = zone === "warm" ? "cache:warm" : zone === "boundary" ? "cache:boundary" : "cache:cold";

    return {
      output: `Wakeup scheduled in ${delay}s [${icon}] (${note})\nReason: ${input.reason}`,
      isError: false,
    };
  },

  prompt() {
    return `ScheduleWakeup: Schedule when to resume work in /loop dynamic mode.

The prompt cache has a ${CACHE_TTL}s (5-minute) TTL. Choose delays with cache in mind:
- 60-${CACHE_WARM_MAX}s: cache stays warm. For active work — checking builds, polling state changes.
- AVOID ~${CACHE_TTL}s: you pay the cache miss without amortizing it. Drop to ${CACHE_WARM_MAX}s or commit to 1200s+.
- 1200-1800s (20-30min): ideal for idle ticks. One cache miss buys a long wait.

Think about what you're waiting for, not round numbers. If a build takes ~8 min, sleep ${CACHE_WARM_MAX}s twice rather than 60s eight times.

Parameters:
- delaySeconds: 60-3600. Clamped by runtime.
- reason: Short sentence shown to user (e.g., "checking build output").
- prompt: The /loop prompt to repeat. Pass the same prompt each turn to continue. Omit the ScheduleWakeup call to end the loop.`;
  },
};
