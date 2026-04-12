/**
 * Tests for raw input key parser — keyboard and mouse event parsing.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseKey } from "./input.js";

describe("parseKey", () => {
  // ── Basic keys ──

  it("parses printable ASCII characters", () => {
    const { event, consumed } = parseKey("a", 0);
    assert.strictEqual(event.char, "a");
    assert.strictEqual(event.name, "a");
    assert.strictEqual(consumed, 1);
  });

  it("parses Enter key", () => {
    const { event } = parseKey("\r", 0);
    assert.strictEqual(event.name, "return");
  });

  it("parses Backspace", () => {
    const { event } = parseKey("\x7f", 0);
    assert.strictEqual(event.name, "backspace");
  });

  it("parses Tab", () => {
    const { event } = parseKey("\t", 0);
    assert.strictEqual(event.name, "tab");
  });

  // ── Ctrl keys ──

  it("parses Ctrl+C", () => {
    const { event } = parseKey("\x03", 0);
    assert.strictEqual(event.char, "c");
    assert.strictEqual(event.ctrl, true);
  });

  it("parses Ctrl+F", () => {
    const { event } = parseKey("\x06", 0);
    assert.strictEqual(event.char, "f");
    assert.strictEqual(event.ctrl, true);
  });

  it("parses Ctrl+O", () => {
    const { event } = parseKey("\x0f", 0);
    assert.strictEqual(event.char, "o");
    assert.strictEqual(event.ctrl, true);
  });

  // ── Arrow keys ──

  it("parses arrow up", () => {
    const { event, consumed } = parseKey("\x1b[A", 0);
    assert.strictEqual(event.name, "up");
    assert.strictEqual(consumed, 3);
  });

  it("parses arrow down", () => {
    const { event } = parseKey("\x1b[B", 0);
    assert.strictEqual(event.name, "down");
  });

  // ── Page keys ──

  it("parses Page Up", () => {
    const { event, consumed } = parseKey("\x1b[5~", 0);
    assert.strictEqual(event.name, "pageup");
    assert.strictEqual(consumed, 4);
  });

  it("parses Page Down", () => {
    const { event } = parseKey("\x1b[6~", 0);
    assert.strictEqual(event.name, "pagedown");
  });

  // ── SGR mouse events ──

  it("parses scroll up (button 64)", () => {
    const { event, consumed } = parseKey("\x1b[<64;40;12M", 0);
    assert.strictEqual(event.name, "scrollup");
    assert.strictEqual(consumed, 12);
  });

  it("parses scroll down (button 65)", () => {
    const { event, consumed } = parseKey("\x1b[<65;40;12M", 0);
    assert.strictEqual(event.name, "scrolldown");
    assert.strictEqual(consumed, 12);
  });

  it("parses mouse click as generic mouse event", () => {
    const { event } = parseKey("\x1b[<0;10;5M", 0);
    assert.strictEqual(event.name, "mouse");
  });

  it("parses mouse release (lowercase m)", () => {
    const { event } = parseKey("\x1b[<0;10;5m", 0);
    assert.strictEqual(event.name, "mouse");
  });

  it("handles partial SGR mouse sequence without crashing", () => {
    // Partial sequence — no terminating M/m
    const { event, consumed } = parseKey("\x1b[<64;40", 0);
    assert.strictEqual(event.name, "mouse");
    // Should consume entire fragment to avoid junk
    assert.ok(consumed > 1, "Should consume partial sequence");
  });

  // ── Escape key ──

  it("parses bare Escape", () => {
    const { event, consumed } = parseKey("\x1b", 0);
    assert.strictEqual(event.name, "escape");
    assert.strictEqual(consumed, 1);
  });

  // ── Shift+Arrow ──

  it("parses Shift+Up", () => {
    const { event, consumed } = parseKey("\x1b[1;2A", 0);
    assert.strictEqual(event.name, "up");
    assert.strictEqual(event.shift, true);
    assert.strictEqual(consumed, 6);
  });

  // ── Alt+char ──

  it("parses Alt+x", () => {
    const { event, consumed } = parseKey("\x1bx", 0);
    assert.strictEqual(event.char, "x");
    assert.strictEqual(event.meta, true);
    assert.strictEqual(consumed, 2);
  });

  // ── Alt+Enter (newline insertion) ──

  it("parses Alt+Enter (ESC+CR) as newline", () => {
    const { event, consumed } = parseKey("\x1b\r", 0);
    assert.strictEqual(event.name, "newline");
    assert.strictEqual(event.char, "\n");
    assert.strictEqual(event.meta, true);
    assert.strictEqual(consumed, 2);
  });

  it("parses Alt+Enter (ESC+LF) as newline", () => {
    const { event } = parseKey("\x1b\n", 0);
    assert.strictEqual(event.name, "newline");
  });

  // ── Offset handling ──

  it("parses at non-zero offset", () => {
    const data = "ab\x1b[Acd";
    const { event, consumed } = parseKey(data, 2);
    assert.strictEqual(event.name, "up");
    assert.strictEqual(consumed, 3);
  });
});
