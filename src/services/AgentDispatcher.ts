/**
 * AgentDispatcher — parallel sub-agent execution with task dependency DAG.
 *
 * Accepts a list of tasks with optional dependencies (blockedBy),
 * dispatches independent tasks to parallel worktrees, collects results,
 * and triggers dependent tasks when their blockers complete.
 */

import type { Provider } from '../providers/base.js';
import type { Tools, ToolContext } from '../Tool.js';
import type { PermissionMode } from '../types/permissions.js';
import { createWorktree, removeWorktree, isGitRepo } from '../git/index.js';

export type AgentTask = {
  id: string;
  prompt: string;
  description?: string;
  blockedBy?: string[];  // task IDs that must complete before this one starts
};

export type AgentTaskResult = {
  id: string;
  output: string;
  isError: boolean;
  durationMs: number;
};

type InternalTask = AgentTask & {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: AgentTaskResult;
};

export class AgentDispatcher {
  private tasks: Map<string, InternalTask>;
  private results: Map<string, AgentTaskResult> = new Map();
  private maxConcurrency: number;

  constructor(
    private provider: Provider,
    private tools: Tools,
    private systemPrompt: string,
    private permissionMode: PermissionMode,
    private model?: string,
    private workingDir?: string,
    private abortSignal?: AbortSignal,
    maxConcurrency = 4,
  ) {
    this.tasks = new Map();
    this.maxConcurrency = maxConcurrency;
  }

  addTask(task: AgentTask): void {
    this.tasks.set(task.id, { ...task, status: 'pending' });
  }

  addTasks(tasks: AgentTask[]): void {
    for (const t of tasks) this.addTask(t);
  }

  /** Execute all tasks respecting dependencies. Returns results in completion order. */
  async execute(): Promise<AgentTaskResult[]> {
    const results: AgentTaskResult[] = [];

    while (true) {
      if (this.abortSignal?.aborted) break;

      // Find tasks ready to run (all blockers completed)
      const ready = [...this.tasks.values()].filter(t =>
        t.status === 'pending' && this.isReady(t),
      );
      const running = [...this.tasks.values()].filter(t => t.status === 'running');

      // All done?
      if (ready.length === 0 && running.length === 0) break;

      // Dispatch up to maxConcurrency
      const toStart = ready.slice(0, this.maxConcurrency - running.length);
      if (toStart.length === 0 && running.length === 0) {
        // Deadlock — blocked tasks with no way to unblock
        for (const t of this.tasks.values()) {
          if (t.status === 'pending') {
            t.status = 'failed';
            const result: AgentTaskResult = {
              id: t.id,
              output: 'Deadlock: blocked dependencies never completed.',
              isError: true,
              durationMs: 0,
            };
            this.results.set(t.id, result);
            results.push(result);
          }
        }
        break;
      }

      // Run tasks in parallel
      const promises = toStart.map(t => {
        t.status = 'running';
        return this.runTask(t).then(result => {
          t.status = 'completed';
          t.result = result;
          this.results.set(t.id, result);
          results.push(result);
        });
      });

      // Wait for at least one to complete before scheduling more
      if (promises.length > 0) {
        await Promise.race(promises);
        // Wait for remaining in this batch
        await Promise.allSettled(promises);
      } else {
        // Running tasks exist but we can't start more — wait for all running
        const runningPromises = [...this.tasks.values()]
          .filter(t => t.status === 'running' && t.result)
          .map(t => Promise.resolve());
        if (runningPromises.length === 0) {
          // Need to poll — running tasks haven't resolved yet
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    return results;
  }

  private isReady(task: InternalTask): boolean {
    if (!task.blockedBy || task.blockedBy.length === 0) return true;
    return task.blockedBy.every(id => {
      const blocker = this.tasks.get(id);
      return blocker && (blocker.status === 'completed' || blocker.status === 'failed');
    });
  }

  private async runTask(task: InternalTask): Promise<AgentTaskResult> {
    const start = Date.now();
    const cwd = this.workingDir ?? process.cwd();
    const useWorktree = isGitRepo(cwd);
    let worktreePath: string | null = null;

    if (useWorktree) {
      worktreePath = createWorktree(cwd);
    }

    try {
      const { query } = await import('../query.js');

      const config = {
        provider: this.provider,
        tools: this.tools,
        systemPrompt: this.systemPrompt,
        permissionMode: this.permissionMode,
        model: this.model,
        maxTurns: 20,
        abortSignal: this.abortSignal,
      };

      // Inject blocker results as context
      let promptWithContext = task.prompt;
      if (task.blockedBy && task.blockedBy.length > 0) {
        const blockerContext = task.blockedBy
          .map(id => {
            const r = this.results.get(id);
            return r ? `## Result from task "${id}":\n${r.output.slice(0, 1000)}` : '';
          })
          .filter(Boolean)
          .join('\n\n');
        if (blockerContext) {
          promptWithContext = `${blockerContext}\n\n---\n\n${task.prompt}`;
        }
      }

      const originalCwd = process.cwd();
      if (worktreePath) {
        try { process.chdir(worktreePath); } catch { /* ignore */ }
      }

      let output = '';
      try {
        for await (const event of query(promptWithContext, config)) {
          if (event.type === 'text_delta') output += event.content;
          if (event.type === 'error') {
            return { id: task.id, output: `Error: ${event.message}`, isError: true, durationMs: Date.now() - start };
          }
        }
      } finally {
        if (worktreePath) {
          try { process.chdir(originalCwd); } catch { /* ignore */ }
        }
      }

      return { id: task.id, output: output || '(no output)', isError: false, durationMs: Date.now() - start };
    } catch (err) {
      return {
        id: task.id,
        output: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        durationMs: Date.now() - start,
      };
    } finally {
      if (worktreePath) {
        removeWorktree(worktreePath, cwd);
      }
    }
  }
}
