/**
 * CronExecutor — background scheduler that runs due cron tasks.
 *
 * Checks every 60 seconds for crons that are due, then executes each
 * by running the cron's prompt through a sub-query loop. Results are
 * persisted to ~/.oh/crons/history/ for debugging and audit.
 *
 * Execution is non-blocking and failure-isolated — one failing cron
 * does not affect others or the main REPL session.
 */

import type { Provider } from '../providers/base.js';
import type { Tools } from '../Tool.js';
import type { PermissionMode } from '../types/permissions.js';
import {
  listCrons,
  getDueCrons,
  updateCron,
  saveCronResult,
  type CronDefinition,
  type CronResult,
} from './cron.js';

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
const MAX_CRON_TURNS = 10;        // Limit sub-query turns for cron tasks

export class CronExecutor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>(); // Prevent overlapping executions
  private _stopped = false;

  constructor(
    private provider: Provider,
    private tools: Tools,
    private systemPrompt: string,
    private permissionMode: PermissionMode,
    private model?: string,
  ) {}

  /** Start the background scheduler */
  start(): void {
    if (this.intervalId) return;
    this._stopped = false;
    // Run first tick after a short delay (don't block startup)
    setTimeout(() => {
      if (!this._stopped) this.tick().catch(() => {});
    }, 5_000);
    // Then check every 60 seconds
    this.intervalId = setInterval(() => {
      if (!this._stopped) this.tick().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  /** Stop the scheduler */
  stop(): void {
    this._stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Check for due crons and execute them */
  async tick(): Promise<CronResult[]> {
    const allCrons = listCrons();
    const due = getDueCrons(allCrons);
    const results: CronResult[] = [];

    for (const cron of due) {
      // Skip if already running (prevent overlapping executions)
      if (this.running.has(cron.id)) continue;

      try {
        const result = await this.executeCron(cron);
        results.push(result);
      } catch (err) {
        // Never let a single cron failure crash the scheduler
        const result: CronResult = {
          cronId: cron.id,
          timestamp: Date.now(),
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
        saveCronResult(result);
        results.push(result);
      }
    }

    return results;
  }

  /** Execute a single cron task */
  private async executeCron(cron: CronDefinition): Promise<CronResult> {
    this.running.add(cron.id);
    const timestamp = Date.now();

    try {
      const { query } = await import('../query.js');

      const config = {
        provider: this.provider,
        tools: this.tools,
        systemPrompt: `[Cron Task: ${cron.name}]\n\n${this.systemPrompt}`,
        permissionMode: this.permissionMode,
        model: this.model,
        maxTurns: MAX_CRON_TURNS,
      };

      let output = '';
      for await (const event of query(cron.prompt, config)) {
        if (event.type === 'text_delta') output += event.content;
        if (event.type === 'error') {
          const result: CronResult = { cronId: cron.id, timestamp, output, error: event.message };
          saveCronResult(result);
          // Still update lastRun on error to prevent rapid retry loops
          cron.lastRun = Date.now();
          cron.runCount++;
          updateCron(cron);
          return result;
        }
      }

      // Success: update cron metadata and save result
      cron.lastRun = Date.now();
      cron.runCount++;
      updateCron(cron);

      const result: CronResult = { cronId: cron.id, timestamp, output };
      saveCronResult(result);
      return result;
    } finally {
      this.running.delete(cron.id);
    }
  }

  /** Whether the executor is currently running */
  get isRunning(): boolean {
    return this.intervalId !== null && !this._stopped;
  }

  /** Get IDs of currently executing crons */
  get activeIds(): string[] {
    return [...this.running];
  }
}
