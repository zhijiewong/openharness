import assert from "node:assert";
import { describe, it } from "node:test";
import { type CronDefinition, getDueCrons, parseScheduleMs } from "./cron.js";

describe("parseScheduleMs", () => {
  it("parses minutes", () => {
    assert.strictEqual(parseScheduleMs("every 5m"), 5 * 60 * 1000);
    assert.strictEqual(parseScheduleMs("every 10 minutes"), 10 * 60 * 1000);
    assert.strictEqual(parseScheduleMs("every 1 min"), 1 * 60 * 1000);
  });

  it("parses hours", () => {
    assert.strictEqual(parseScheduleMs("every 2h"), 2 * 60 * 60 * 1000);
    assert.strictEqual(parseScheduleMs("every 1 hour"), 1 * 60 * 60 * 1000);
  });

  it("parses days", () => {
    assert.strictEqual(parseScheduleMs("every 1d"), 24 * 60 * 60 * 1000);
    assert.strictEqual(parseScheduleMs("every 7 days"), 7 * 24 * 60 * 60 * 1000);
  });

  it("returns null for invalid", () => {
    assert.strictEqual(parseScheduleMs("invalid"), null);
    assert.strictEqual(parseScheduleMs("* * * * *"), null);
  });
});

describe("getDueCrons", () => {
  it("returns crons past their interval", () => {
    const now = Date.now();
    const crons: CronDefinition[] = [
      {
        id: "1",
        name: "test",
        schedule: "every 5m",
        prompt: "hi",
        enabled: true,
        createdAt: now - 10 * 60 * 1000,
        lastRun: now - 10 * 60 * 1000,
        runCount: 0,
      },
    ];
    const due = getDueCrons(crons);
    assert.strictEqual(due.length, 1);
  });

  it("skips crons not yet due", () => {
    const now = Date.now();
    const crons: CronDefinition[] = [
      {
        id: "1",
        name: "test",
        schedule: "every 5m",
        prompt: "hi",
        enabled: true,
        createdAt: now,
        lastRun: now,
        runCount: 0,
      },
    ];
    const due = getDueCrons(crons);
    assert.strictEqual(due.length, 0);
  });

  it("skips disabled crons", () => {
    const now = Date.now();
    const crons: CronDefinition[] = [
      {
        id: "1",
        name: "test",
        schedule: "every 5m",
        prompt: "hi",
        enabled: false,
        createdAt: now - 10 * 60 * 1000,
        runCount: 0,
      },
    ];
    const due = getDueCrons(crons);
    assert.strictEqual(due.length, 0);
  });
});
