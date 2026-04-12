/**
 * Tests for terminal image rendering.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isImageOutput, renderImageInline } from "./image.js";

// ── isImageOutput ──

test("isImageOutput() returns true for image output strings", () => {
  assert.equal(isImageOutput("__IMAGE__:image/png:iVBOR"), true);
});

test("isImageOutput() returns false for regular strings", () => {
  assert.equal(isImageOutput("hello world"), false);
  assert.equal(isImageOutput(""), false);
});

test("isImageOutput() returns false for partial prefix", () => {
  assert.equal(isImageOutput("__IMAGE__"), false);
  assert.equal(isImageOutput("__IMAGE_"), false);
});

// ── renderImageInline ──

test("renderImageInline() returns parse error for invalid input", () => {
  const result = renderImageInline("not an image");
  assert.ok(result.includes("parse error"));
});

test("renderImageInline() fallback shows media type and size", () => {
  // Force no protocol support by clearing env vars
  const origTerm = process.env.TERM_PROGRAM;
  const origTermVar = process.env.TERM;
  delete process.env.TERM_PROGRAM;
  process.env.TERM = "xterm-256color";

  const base64 = Buffer.from("test image data").toString("base64");
  const result = renderImageInline(`__IMAGE__:image/png:${base64}`);
  assert.ok(result.includes("image/png"));
  assert.ok(result.includes("KB"));

  // Restore
  if (origTerm !== undefined) process.env.TERM_PROGRAM = origTerm;
  else delete process.env.TERM_PROGRAM;
  if (origTermVar !== undefined) process.env.TERM = origTermVar;
  else delete process.env.TERM;
});

test("renderImageInline() kitty protocol produces escape sequences", () => {
  const origTerm = process.env.TERM_PROGRAM;
  process.env.TERM_PROGRAM = "kitty";

  const base64 = Buffer.from("tiny").toString("base64");
  const result = renderImageInline(`__IMAGE__:image/png:${base64}`);
  assert.ok(result.includes("\x1b_G")); // Kitty escape

  if (origTerm !== undefined) process.env.TERM_PROGRAM = origTerm;
  else delete process.env.TERM_PROGRAM;
});

test("renderImageInline() iterm protocol produces escape sequences", () => {
  const origTerm = process.env.TERM_PROGRAM;
  process.env.TERM_PROGRAM = "iTerm2.app";

  const base64 = Buffer.from("tiny").toString("base64");
  const result = renderImageInline(`__IMAGE__:image/png:${base64}`);
  assert.ok(result.includes("\x1b]1337;File=")); // iTerm escape

  if (origTerm !== undefined) process.env.TERM_PROGRAM = origTerm;
  else delete process.env.TERM_PROGRAM;
});
