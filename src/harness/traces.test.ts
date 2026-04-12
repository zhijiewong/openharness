import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportTraceOTLP, formatTrace, SessionTracer } from "./traces.js";

describe("SessionTracer", () => {
  it("starts and ends spans", () => {
    const tracer = new SessionTracer("test-session");
    const spanId = tracer.startSpan("test_span", { tool: "Read" });
    const span = tracer.endSpan(spanId);
    assert.ok(span);
    assert.equal(span.name, "test_span");
    assert.equal(span.status, "ok");
    assert.ok(span.durationMs >= 0);
    assert.equal(span.attributes.tool, "Read");
  });

  it("tracks multiple spans", () => {
    const tracer = new SessionTracer("test-session");
    tracer.startSpan("span1");
    tracer.startSpan("span2");
    tracer.endSpan("span-1");
    tracer.endSpan("span-2");
    assert.equal(tracer.getSpans().length, 2);
  });

  it("supports parent-child relationships", () => {
    const tracer = new SessionTracer("test-session");
    const parent = tracer.startSpan("parent");
    const child = tracer.startSpan("child", {}, parent);
    tracer.endSpan(child);
    tracer.endSpan(parent);

    const spans = tracer.getSpans();
    const childSpan = spans.find((s) => s.name === "child");
    assert.ok(childSpan);
    assert.equal(childSpan.parentSpanId, parent);
  });

  it("records error status", () => {
    const tracer = new SessionTracer("test-session");
    const spanId = tracer.startSpan("failing");
    const span = tracer.endSpan(spanId, "error");
    assert.ok(span);
    assert.equal(span.status, "error");
  });

  it("returns null for unknown span ID", () => {
    const tracer = new SessionTracer("test-session");
    assert.equal(tracer.endSpan("nonexistent"), null);
  });

  it("getSummary returns correct stats", () => {
    const tracer = new SessionTracer("test-session");
    const s1 = tracer.startSpan("tool_call");
    tracer.endSpan(s1);
    const s2 = tracer.startSpan("tool_call");
    tracer.endSpan(s2);
    const s3 = tracer.startSpan("error_span");
    tracer.endSpan(s3, "error");

    const summary = tracer.getSummary();
    assert.equal(summary.totalSpans, 3);
    assert.equal(summary.errors, 1);
    assert.ok(summary.spansByName.tool_call);
    assert.equal(summary.spansByName.tool_call!.count, 2);
  });
});

describe("formatTrace", () => {
  it("formats empty trace", () => {
    assert.ok(formatTrace([]).includes("No trace"));
  });

  it("formats spans with tree structure", () => {
    const spans = [
      {
        spanId: "s1",
        name: "query_turn",
        startTime: 1000,
        endTime: 2000,
        durationMs: 1000,
        attributes: {},
        status: "ok" as const,
      },
      {
        spanId: "s2",
        parentSpanId: "s1",
        name: "tool_call",
        startTime: 1100,
        endTime: 1500,
        durationMs: 400,
        attributes: { tool: "Read" },
        status: "ok" as const,
      },
    ];
    const output = formatTrace(spans);
    assert.ok(output.includes("query_turn"));
    assert.ok(output.includes("tool_call"));
    assert.ok(output.includes("1000ms"));
  });
});

describe("exportTraceOTLP", () => {
  it("exports in OpenTelemetry format", () => {
    const spans = [
      {
        spanId: "s1",
        name: "test",
        startTime: 1000,
        endTime: 2000,
        durationMs: 1000,
        attributes: { key: "value" },
        status: "ok" as const,
      },
    ];
    const otlp = exportTraceOTLP("test-session", spans) as any;
    assert.ok(otlp.resourceSpans);
    assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans.length, 1);
    assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans[0].name, "test");
  });
});
