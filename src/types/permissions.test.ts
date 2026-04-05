import test from "node:test";
import assert from "node:assert/strict";
import { checkPermission } from "./permissions.js";

test("trust mode allows everything", () => {
  const r = checkPermission("trust", "high", false);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "trust-mode");
});

test("deny mode blocks non-low", () => {
  const r = checkPermission("deny", "medium", false);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "deny-mode");
});

test("deny mode allows low+readonly", () => {
  const r = checkPermission("deny", "low", true);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "auto-approved");
});

test("ask mode: low+readonly auto-approved", () => {
  const r = checkPermission("ask", "low", true);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "auto-approved");
});

test("ask mode: high risk returns needs-approval", () => {
  const r = checkPermission("ask", "high", false);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "needs-approval");
});

test("ask mode: medium risk returns needs-approval", () => {
  const r = checkPermission("ask", "medium", false);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "needs-approval");
});

// ── acceptEdits mode ──

test("acceptEdits auto-approves FileWrite", () => {
  const r = checkPermission("acceptEdits", "medium", false, "FileWrite");
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "acceptEdits-auto");
});

test("acceptEdits auto-approves FileEdit", () => {
  const r = checkPermission("acceptEdits", "medium", false, "FileEdit");
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "acceptEdits-auto");
});

test("acceptEdits requires approval for Bash", () => {
  const r = checkPermission("acceptEdits", "high", false, "Bash");
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "needs-approval");
});

test("acceptEdits auto-approves low+readonly even without toolName", () => {
  const r = checkPermission("acceptEdits", "low", true);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "auto-approved");
});

// ── plan mode ──

test("plan mode allows read-only ops", () => {
  const r = checkPermission("plan", "low", true);
  assert.equal(r.allowed, true);
});

test("plan mode blocks writes", () => {
  const r = checkPermission("plan", "medium", false);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "plan-mode-no-writes");
});

test("plan mode allows high-risk reads", () => {
  const r = checkPermission("plan", "high", true);
  assert.equal(r.allowed, true);
  assert.equal(r.reason, "plan-mode-readonly");
});
