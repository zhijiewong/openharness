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
