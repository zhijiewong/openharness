/**
 * Opt-in telemetry — anonymous usage tracking for feature prioritization.
 *
 * Default: OFF. Enable via config.yaml:
 *   telemetry:
 *     enabled: true
 *
 * Privacy: never logs file paths, prompts, tool output, or API keys.
 * Only tracks: tool names, durations, error categories, session metadata.
 *
 * Events are batched locally as JSONL in ~/.oh/telemetry/.
 * Optional: POST to configurable endpoint on session end.
 */

import { appendFileSync, mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readOhConfig } from './config.js';

const TELEMETRY_DIR = join(homedir(), '.oh', 'telemetry');

// ── Types ──

export type TelemetryEvent = {
  type: 'session_start' | 'tool_call' | 'error' | 'session_end';
  timestamp: number;
  sessionId: string;
  payload: TelemetryPayload;
};

export type TelemetryPayload = {
  // session_start
  provider?: string;
  model?: string;
  platform?: string;

  // tool_call
  toolName?: string;
  durationMs?: number;
  isError?: boolean;

  // error
  errorCategory?: string;  // 'rate_limit' | 'network' | 'permission' | 'timeout' | 'unknown'

  // session_end
  totalTurns?: number;
  totalCost?: number;
  totalToolCalls?: number;
  durationMinutes?: number;
};

// ── State ──

let _enabled: boolean | undefined;
let _sessionFile: string | null = null;

function isEnabled(): boolean {
  if (_enabled !== undefined) return _enabled;
  const config = readOhConfig();
  _enabled = config?.telemetry?.enabled === true;
  return _enabled;
}

function getSessionFile(sessionId: string): string {
  if (_sessionFile) return _sessionFile;
  mkdirSync(TELEMETRY_DIR, { recursive: true });
  _sessionFile = join(TELEMETRY_DIR, `${sessionId}.jsonl`);
  return _sessionFile;
}

// ── Public API ──

/** Record a telemetry event (no-op if telemetry disabled) */
export function recordEvent(event: TelemetryEvent): void {
  if (!isEnabled()) return;

  try {
    const file = getSessionFile(event.sessionId);
    appendFileSync(file, JSON.stringify(event) + '\n');
  } catch { /* never crash on telemetry failure */ }
}

/** Convenience: record a tool call event */
export function recordToolCall(
  sessionId: string,
  toolName: string,
  durationMs: number,
  isError: boolean,
): void {
  recordEvent({
    type: 'tool_call',
    timestamp: Date.now(),
    sessionId,
    payload: { toolName, durationMs, isError },
  });
}

/** Convenience: record session start */
export function recordSessionStart(
  sessionId: string,
  provider: string,
  model: string,
): void {
  recordEvent({
    type: 'session_start',
    timestamp: Date.now(),
    sessionId,
    payload: { provider, model, platform: process.platform },
  });
}

/** Convenience: record session end with stats */
export function recordSessionEnd(
  sessionId: string,
  stats: { totalTurns: number; totalCost: number; totalToolCalls: number; durationMinutes: number },
): void {
  recordEvent({
    type: 'session_end',
    timestamp: Date.now(),
    sessionId,
    payload: stats,
  });
}

/** Convenience: record an error */
export function recordError(
  sessionId: string,
  category: string,
): void {
  recordEvent({
    type: 'error',
    timestamp: Date.now(),
    sessionId,
    payload: { errorCategory: category },
  });
}

/** Read local telemetry events for a session */
export function readSessionEvents(sessionId: string): TelemetryEvent[] {
  const file = join(TELEMETRY_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];

  try {
    return readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as TelemetryEvent);
  } catch { return []; }
}

/** Get aggregate stats across all sessions */
export function getAggregateStats(): {
  totalSessions: number;
  totalEvents: number;
  toolUsage: Record<string, number>;
  errorCategories: Record<string, number>;
} {
  if (!existsSync(TELEMETRY_DIR)) return { totalSessions: 0, totalEvents: 0, toolUsage: {}, errorCategories: {} };

  const files = readdirSync(TELEMETRY_DIR).filter(f => f.endsWith('.jsonl'));
  const toolUsage: Record<string, number> = {};
  const errorCategories: Record<string, number> = {};
  let totalEvents = 0;

  for (const file of files) {
    try {
      const lines = readFileSync(join(TELEMETRY_DIR, file), 'utf-8').split('\n').filter(Boolean);
      totalEvents += lines.length;

      for (const line of lines) {
        const event = JSON.parse(line) as TelemetryEvent;
        if (event.type === 'tool_call' && event.payload.toolName) {
          toolUsage[event.payload.toolName] = (toolUsage[event.payload.toolName] ?? 0) + 1;
        }
        if (event.type === 'error' && event.payload.errorCategory) {
          errorCategories[event.payload.errorCategory] = (errorCategories[event.payload.errorCategory] ?? 0) + 1;
        }
      }
    } catch { /* skip malformed files */ }
  }

  return { totalSessions: files.length, totalEvents, toolUsage, errorCategories };
}

/** Reset telemetry cache (for testing or config changes) */
export function resetTelemetry(): void {
  _enabled = undefined;
  _sessionFile = null;
}
