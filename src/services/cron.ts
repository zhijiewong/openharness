/**
 * Cron scheduler — run prompts on recurring schedules.
 *
 * Cron definitions are stored in ~/.oh/crons/ as JSON files.
 * Each cron has an id, schedule (cron expression), prompt, and metadata.
 *
 * This is a simple implementation using setInterval for minute-level granularity.
 * For production use, consider node-cron or similar.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CRON_DIR = join(homedir(), '.oh', 'crons');

export type CronDefinition = {
  id: string;
  name: string;
  schedule: string;       // simplified: "every Nm" (minutes), "every Nh" (hours), "daily HH:MM"
  prompt: string;         // the prompt to run
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  runCount: number;
};

export type CronResult = {
  cronId: string;
  timestamp: number;
  output: string;
  error?: string;
};

/** List all cron definitions */
export function listCrons(): CronDefinition[] {
  if (!existsSync(CRON_DIR)) return [];
  return readdirSync(CRON_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(CRON_DIR, f), 'utf-8')) as CronDefinition;
      } catch { return null; }
    })
    .filter((c): c is CronDefinition => c !== null);
}

/** Create a new cron definition */
export function createCron(name: string, schedule: string, prompt: string): CronDefinition {
  mkdirSync(CRON_DIR, { recursive: true });

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cron: CronDefinition = {
    id,
    name,
    schedule,
    prompt,
    enabled: true,
    createdAt: Date.now(),
    runCount: 0,
  };

  writeFileSync(join(CRON_DIR, `${id}.json`), JSON.stringify(cron, null, 2));
  return cron;
}

/** Delete a cron definition */
export function deleteCron(id: string): boolean {
  const path = join(CRON_DIR, `${id}.json`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Update a cron definition (e.g., after a run) */
export function updateCron(cron: CronDefinition): void {
  mkdirSync(CRON_DIR, { recursive: true });
  writeFileSync(join(CRON_DIR, `${cron.id}.json`), JSON.stringify(cron, null, 2));
}

/** Parse a simplified schedule string into milliseconds interval */
export function parseScheduleMs(schedule: string): number | null {
  // "every 5m" → 5 minutes
  const minMatch = schedule.match(/^every\s+(\d+)\s*m(?:in(?:ute)?s?)?$/i);
  if (minMatch) return parseInt(minMatch[1]!) * 60 * 1000;

  // "every 2h" → 2 hours
  const hourMatch = schedule.match(/^every\s+(\d+)\s*h(?:ours?)?$/i);
  if (hourMatch) return parseInt(hourMatch[1]!) * 60 * 60 * 1000;

  // "every 1d" → 1 day
  const dayMatch = schedule.match(/^every\s+(\d+)\s*d(?:ays?)?$/i);
  if (dayMatch) return parseInt(dayMatch[1]!) * 24 * 60 * 60 * 1000;

  return null;
}

/**
 * Check which crons are due to run based on their schedule and lastRun.
 */
export function getDueCrons(crons: CronDefinition[]): CronDefinition[] {
  const now = Date.now();
  return crons.filter(c => {
    if (!c.enabled) return false;
    const intervalMs = parseScheduleMs(c.schedule);
    if (!intervalMs) return false;
    const lastRun = c.lastRun ?? c.createdAt;
    return (now - lastRun) >= intervalMs;
  });
}
