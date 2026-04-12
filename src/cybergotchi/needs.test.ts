import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "./config.js";
import { adjustNeed, applyEvent, decayNeeds } from "./needs.js";

function makeConfig() {
  return defaultConfig("duck", "Test");
}

// ── decayNeeds ──

test("decayNeeds: no change on tiny elapsed time", () => {
  const cfg = makeConfig();
  cfg.needsUpdatedAt = Date.now(); // just now
  const before = { ...cfg.needs };
  decayNeeds(cfg);
  assert.deepEqual(cfg.needs, before);
});

test("decayNeeds: reduces needs after 1 hour", () => {
  const cfg = makeConfig();
  cfg.needs = { hunger: 100, energy: 100, happiness: 100 };
  cfg.needsUpdatedAt = Date.now() - 3_600_000; // 1 hour ago
  decayNeeds(cfg);
  assert.ok(cfg.needs.hunger < 100, "hunger should decay");
  assert.ok(cfg.needs.energy < 100, "energy should decay");
  assert.ok(cfg.needs.happiness < 100, "happiness should decay");
  // Hunger decays at 5/hr, energy 3/hr, happiness 2/hr
  assert.ok(Math.abs(cfg.needs.hunger - 95) < 1);
  assert.ok(Math.abs(cfg.needs.energy - 97) < 1);
  assert.ok(Math.abs(cfg.needs.happiness - 98) < 1);
});

test("decayNeeds: clamps at 0", () => {
  const cfg = makeConfig();
  cfg.needs = { hunger: 1, energy: 1, happiness: 1 };
  cfg.needsUpdatedAt = Date.now() - 100 * 3_600_000; // 100 hours ago
  decayNeeds(cfg);
  assert.equal(cfg.needs.hunger, 0);
  assert.equal(cfg.needs.energy, 0);
  assert.equal(cfg.needs.happiness, 0);
});

test("decayNeeds: updates needsUpdatedAt", () => {
  const cfg = makeConfig();
  cfg.needsUpdatedAt = Date.now() - 3_600_000;
  const before = cfg.needsUpdatedAt;
  decayNeeds(cfg);
  assert.ok(cfg.needsUpdatedAt > before);
});

// ── adjustNeed ──

test("adjustNeed: increases need", () => {
  const cfg = makeConfig();
  cfg.needs.hunger = 50;
  adjustNeed(cfg, "hunger", 30);
  assert.equal(cfg.needs.hunger, 80);
});

test("adjustNeed: clamps at 100", () => {
  const cfg = makeConfig();
  cfg.needs.energy = 90;
  adjustNeed(cfg, "energy", 20);
  assert.equal(cfg.needs.energy, 100);
});

test("adjustNeed: clamps at 0", () => {
  const cfg = makeConfig();
  cfg.needs.happiness = 5;
  adjustNeed(cfg, "happiness", -20);
  assert.equal(cfg.needs.happiness, 0);
});

// ── applyEvent ──

test("applyEvent: toolSuccess increments streak", () => {
  const cfg = makeConfig();
  cfg.currentStreak = 3;
  applyEvent(cfg, "toolSuccess");
  assert.equal(cfg.currentStreak, 4);
});

test("applyEvent: toolError resets streak and increments totalErrors", () => {
  const cfg = makeConfig();
  cfg.currentStreak = 10;
  cfg.lifetime.totalErrors = 2;
  applyEvent(cfg, "toolError");
  assert.equal(cfg.currentStreak, 0);
  assert.equal(cfg.lifetime.totalErrors, 3);
});

test("applyEvent: commit increments totalCommits", () => {
  const cfg = makeConfig();
  cfg.lifetime.totalCommits = 5;
  applyEvent(cfg, "commit");
  assert.equal(cfg.lifetime.totalCommits, 6);
});

test("applyEvent: taskComplete increments totalTasksCompleted", () => {
  const cfg = makeConfig();
  cfg.lifetime.totalTasksCompleted = 10;
  applyEvent(cfg, "taskComplete");
  assert.equal(cfg.lifetime.totalTasksCompleted, 11);
});

test("applyEvent: toolSuccess boosts happiness", () => {
  const cfg = makeConfig();
  const before = cfg.needs.happiness;
  applyEvent(cfg, "toolSuccess");
  assert.ok(cfg.needs.happiness > before);
});

test("applyEvent: toolError reduces happiness", () => {
  const cfg = makeConfig();
  cfg.needs.happiness = 50;
  applyEvent(cfg, "toolError");
  assert.ok(cfg.needs.happiness < 50);
});

test("applyEvent: longestStreak updates on new record", () => {
  const cfg = makeConfig();
  cfg.currentStreak = 4;
  cfg.lifetime.longestStreak = 4;
  applyEvent(cfg, "toolSuccess"); // streak becomes 5
  assert.equal(cfg.lifetime.longestStreak, 5);
});

// ── Evolution ──

test("evolution: stage 0 by default", () => {
  const cfg = makeConfig();
  assert.equal(cfg.evolutionStage, 0);
});

test("evolution: stage 1 at 10 sessions", () => {
  const cfg = makeConfig();
  cfg.lifetime.totalSessions = 10;
  const speech = applyEvent(cfg, "toolSuccess");
  assert.equal(cfg.evolutionStage, 1);
  assert.ok(speech?.includes("evolving"));
});

test("evolution: stage 1 at 50 commits", () => {
  const cfg = makeConfig();
  cfg.lifetime.totalCommits = 49;
  applyEvent(cfg, "commit"); // pushes to 50
  assert.equal(cfg.evolutionStage, 1);
});

test("evolution: stage 2 at 100 tasks", () => {
  const cfg = makeConfig();
  cfg.evolutionStage = 1;
  cfg.lifetime.totalTasksCompleted = 99;
  const speech = applyEvent(cfg, "taskComplete");
  assert.equal(cfg.evolutionStage, 2);
  assert.ok(speech?.includes("LEGENDARY"));
});

test("evolution: stage 2 at longestStreak >= 25", () => {
  const cfg = makeConfig();
  cfg.evolutionStage = 1;
  cfg.currentStreak = 24;
  cfg.lifetime.longestStreak = 24;
  applyEvent(cfg, "toolSuccess"); // streak → 25, longestStreak → 25
  assert.equal(cfg.evolutionStage, 2);
});

test("evolution: does not downgrade stage", () => {
  const cfg = makeConfig();
  cfg.evolutionStage = 2;
  applyEvent(cfg, "toolError");
  assert.equal(cfg.evolutionStage, 2);
});
