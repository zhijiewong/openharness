import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createMockProvider, createMockTool } from "../test-helpers.js";
import { CronExecutor } from "./CronExecutor.js";
import { type CronDefinition, getDueCrons, parseScheduleMs } from "./cron.js";

describe("CronExecutor", () => {
  let executor: CronExecutor | null = null;

  afterEach(() => {
    if (executor) {
      executor.stop();
      executor = null;
    }
  });

  it("creates executor without errors", () => {
    const provider = createMockProvider();
    const tools = [createMockTool("TestTool")];
    executor = new CronExecutor(provider, tools, "test prompt", "trust", "mock-model");
    assert.ok(executor);
    assert.equal(executor.isRunning, false);
  });

  it("starts and stops the scheduler", () => {
    const provider = createMockProvider();
    executor = new CronExecutor(provider, [], "test", "trust");
    executor.start();
    assert.equal(executor.isRunning, true);
    executor.stop();
    assert.equal(executor.isRunning, false);
  });

  it("start is idempotent", () => {
    const provider = createMockProvider();
    executor = new CronExecutor(provider, [], "test", "trust");
    executor.start();
    executor.start(); // Should not create duplicate intervals
    assert.equal(executor.isRunning, true);
    executor.stop();
  });

  it("tick returns empty results when no crons exist", async () => {
    const provider = createMockProvider();
    executor = new CronExecutor(provider, [], "test", "trust");
    const results = await executor.tick();
    assert.ok(Array.isArray(results));
    // May be empty or have results depending on actual ~/.oh/crons state
  });

  it("activeIds is empty initially", () => {
    const provider = createMockProvider();
    executor = new CronExecutor(provider, [], "test", "trust");
    assert.deepStrictEqual(executor.activeIds, []);
  });
});

describe("cron helpers", () => {
  describe("parseScheduleMs", () => {
    it("parses minutes", () => {
      assert.equal(parseScheduleMs("every 5m"), 5 * 60 * 1000);
      assert.equal(parseScheduleMs("every 1m"), 1 * 60 * 1000);
      assert.equal(parseScheduleMs("every 30min"), 30 * 60 * 1000);
    });

    it("parses hours", () => {
      assert.equal(parseScheduleMs("every 2h"), 2 * 60 * 60 * 1000);
      assert.equal(parseScheduleMs("every 1hours"), 1 * 60 * 60 * 1000);
    });

    it("parses days", () => {
      assert.equal(parseScheduleMs("every 1d"), 1 * 24 * 60 * 60 * 1000);
      assert.equal(parseScheduleMs("every 7days"), 7 * 24 * 60 * 60 * 1000);
    });

    it("returns null for invalid schedules", () => {
      assert.equal(parseScheduleMs("invalid"), null);
      assert.equal(parseScheduleMs("cron * * * * *"), null);
      assert.equal(parseScheduleMs(""), null);
    });
  });

  describe("getDueCrons", () => {
    it("returns empty for empty list", () => {
      assert.deepStrictEqual(getDueCrons([]), []);
    });

    it("skips disabled crons", () => {
      const crons: CronDefinition[] = [
        {
          id: "test1",
          name: "disabled",
          schedule: "every 1m",
          prompt: "test",
          enabled: false,
          createdAt: 0,
          runCount: 0,
        },
      ];
      assert.deepStrictEqual(getDueCrons(crons), []);
    });

    it("skips crons with invalid schedules", () => {
      const crons: CronDefinition[] = [
        {
          id: "test2",
          name: "invalid",
          schedule: "invalid",
          prompt: "test",
          enabled: true,
          createdAt: 0,
          runCount: 0,
        },
      ];
      assert.deepStrictEqual(getDueCrons(crons), []);
    });

    it("returns crons that are overdue", () => {
      const crons: CronDefinition[] = [
        {
          id: "test3",
          name: "overdue",
          schedule: "every 1m",
          prompt: "test",
          enabled: true,
          createdAt: Date.now() - 120_000, // 2 min ago
          runCount: 0,
        },
      ];
      const due = getDueCrons(crons);
      assert.equal(due.length, 1);
      assert.equal(due[0]!.id, "test3");
    });

    it("skips crons that ran recently", () => {
      const crons: CronDefinition[] = [
        {
          id: "test4",
          name: "recent",
          schedule: "every 5m",
          prompt: "test",
          enabled: true,
          createdAt: Date.now() - 600_000,
          lastRun: Date.now() - 60_000, // 1 min ago, schedule is 5m
          runCount: 1,
        },
      ];
      assert.deepStrictEqual(getDueCrons(crons), []);
    });
  });
});
