import assert from "node:assert/strict";
import test from "node:test";
import { createKeybindingMatcher } from "./keybindings.js";

test("default bindings include ctrl+d -> /diff", () => {
  const matcher = createKeybindingMatcher();
  const bindings = matcher.getBindings();
  const diffBinding = bindings.find((b) => b.key === "ctrl+d");
  assert.ok(diffBinding);
  assert.equal(diffBinding!.action, "/diff");
});

test("ctrl+d with correct modifiers returns /diff", () => {
  const matcher = createKeybindingMatcher();
  const result = matcher.match("d", { ctrl: true, meta: false, shift: false });
  assert.equal(result, "/diff");
});

test("non-matching key returns null", () => {
  const matcher = createKeybindingMatcher();
  const result = matcher.match("x", { ctrl: true, meta: false, shift: false });
  assert.equal(result, null);
});

test("getBindings() returns array with default bindings", () => {
  const matcher = createKeybindingMatcher();
  const bindings = matcher.getBindings();
  assert.ok(Array.isArray(bindings));
  assert.ok(bindings.length >= 3);
  assert.ok(bindings.every((b) => typeof b.key === "string" && typeof b.action === "string"));
});

test("unknown key combo returns null", () => {
  const matcher = createKeybindingMatcher();
  const result = matcher.match("z", { ctrl: false, meta: false, shift: false });
  assert.equal(result, null);
});

test("ctrl+l returns /clear", () => {
  const matcher = createKeybindingMatcher();
  const result = matcher.match("l", { ctrl: true, meta: false, shift: false });
  assert.equal(result, "/clear");
});
