/**
 * Session Traces — structured observability for agent sessions.
 *
 * Every query turn, tool call, LLM stream, and compression event
 * generates a trace span. Traces enable debugging, replay, and
 * performance analysis.
 *
 * Compatible with OpenTelemetry export format.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TRACE_DIR = join(homedir(), ".oh", "traces");

// ── Types ──

export type TraceSpan = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
};

export type TraceEvent = {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
};

// ── Tracer ──

const MAX_IN_MEMORY_SPANS = 1000;

export class SessionTracer {
  private sessionId: string;
  private spans: TraceSpan[] = [];
  private activeSpans = new Map<
    string,
    { name: string; startTime: number; parentSpanId?: string; attributes: Record<string, unknown> }
  >();
  private spanCounter = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Start a new span. Returns the span ID. */
  startSpan(name: string, attributes: Record<string, unknown> = {}, parentSpanId?: string): string {
    const spanId = `span-${++this.spanCounter}`;
    this.activeSpans.set(spanId, { name, startTime: Date.now(), parentSpanId, attributes });
    return spanId;
  }

  /** End a span and record it. */
  endSpan(spanId: string, status: "ok" | "error" = "ok", extraAttributes?: Record<string, unknown>): TraceSpan | null {
    const active = this.activeSpans.get(spanId);
    if (!active) return null;

    this.activeSpans.delete(spanId);
    const endTime = Date.now();
    const span: TraceSpan = {
      spanId,
      parentSpanId: active.parentSpanId,
      name: active.name,
      startTime: active.startTime,
      endTime,
      durationMs: endTime - active.startTime,
      attributes: { ...active.attributes, ...extraAttributes },
      status,
    };

    this.spans.push(span);
    // Cap in-memory spans (durable source is on disk)
    if (this.spans.length > MAX_IN_MEMORY_SPANS) {
      this.spans = this.spans.slice(-MAX_IN_MEMORY_SPANS);
    }
    this.persistSpan(span);
    return span;
  }

  /** Get all completed spans */
  getSpans(): TraceSpan[] {
    return [...this.spans];
  }

  /** Get a summary of the trace */
  getSummary(): {
    totalSpans: number;
    totalDurationMs: number;
    spansByName: Record<string, { count: number; totalMs: number }>;
    errors: number;
  } {
    const spansByName: Record<string, { count: number; totalMs: number }> = {};
    let errors = 0;
    let minStart = Infinity;
    let maxEnd = 0;

    for (const span of this.spans) {
      const entry = spansByName[span.name] ?? { count: 0, totalMs: 0 };
      entry.count++;
      entry.totalMs += span.durationMs;
      spansByName[span.name] = entry;

      if (span.status === "error") errors++;
      if (span.startTime < minStart) minStart = span.startTime;
      if (span.endTime > maxEnd) maxEnd = span.endTime;
    }

    return {
      totalSpans: this.spans.length,
      totalDurationMs: maxEnd > minStart ? maxEnd - minStart : 0,
      spansByName,
      errors,
    };
  }

  /** Persist a span to the trace file */
  private persistSpan(span: TraceSpan): void {
    try {
      mkdirSync(TRACE_DIR, { recursive: true });
      const file = join(TRACE_DIR, `${this.sessionId}.jsonl`);
      appendFileSync(file, `${JSON.stringify(span)}\n`);
    } catch {
      /* never crash on tracing failure */
    }
  }
}

// ── Trace Loading ──

/** Load trace spans for a session */
export function loadTrace(sessionId: string): TraceSpan[] {
  const file = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];

  try {
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceSpan);
  } catch {
    return [];
  }
}

/** List all sessions with traces */
export function listTracedSessions(): string[] {
  if (!existsSync(TRACE_DIR)) return [];
  return readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(".jsonl", ""));
}

/** Format trace for display */
export function formatTrace(spans: TraceSpan[]): string {
  if (spans.length === 0) return "No trace spans recorded.";

  const lines: string[] = [`Trace (${spans.length} spans):\n`];

  // Group by parent for tree display
  const roots = spans.filter((s) => !s.parentSpanId);
  const children = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    if (s.parentSpanId) {
      const list = children.get(s.parentSpanId) ?? [];
      list.push(s);
      children.set(s.parentSpanId, list);
    }
  }

  function renderSpan(span: TraceSpan, indent: number): void {
    const status = span.status === "error" ? "✗" : "✓";
    const pad = "  ".repeat(indent);
    const attrs = Object.entries(span.attributes)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
      .join(" ");

    lines.push(`${pad}${status} ${span.name} (${span.durationMs}ms) ${attrs}`);

    const kids = children.get(span.spanId) ?? [];
    for (const kid of kids) renderSpan(kid, indent + 1);
  }

  for (const root of roots) renderSpan(root, 0);

  // Summary
  const totalMs = spans.reduce((sum, s) => sum + s.durationMs, 0);
  const errors = spans.filter((s) => s.status === "error").length;
  lines.push("");
  lines.push(`Total: ${spans.length} spans, ${totalMs}ms, ${errors} errors`);

  return lines.join("\n");
}

/** Export trace in OpenTelemetry-compatible format */
export function exportTraceOTLP(sessionId: string, spans: TraceSpan[]): object {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "openharness" } },
            { key: "session.id", value: { stringValue: sessionId } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "openharness.agent" },
            spans: spans.map((s) => ({
              traceId: sessionId.padEnd(32, "0").slice(0, 32),
              spanId: s.spanId.padEnd(16, "0").slice(0, 16),
              parentSpanId: s.parentSpanId?.padEnd(16, "0").slice(0, 16),
              name: s.name,
              startTimeUnixNano: s.startTime * 1_000_000,
              endTimeUnixNano: s.endTime * 1_000_000,
              attributes: Object.entries(s.attributes).map(([k, v]) => ({
                key: k,
                value: { stringValue: String(v) },
              })),
              status: { code: s.status === "ok" ? 1 : 2 },
            })),
          },
        ],
      },
    ],
  };
}
