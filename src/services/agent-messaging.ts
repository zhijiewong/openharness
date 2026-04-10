/**
 * Agent messaging — peer-to-peer communication between sub-agents.
 *
 * Provides a message bus for agents to send/receive messages, share state,
 * and coordinate work. Uses file-based locking for concurrent file access.
 *
 * Architecture (inspired by Claude Code Agent Teams):
 * - Each agent has a unique ID
 * - Messages are stored in a shared inbox (in-memory for same-process agents)
 * - File locking prevents concurrent edits to the same file
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type AgentMessage = {
  from: string;       // sender agent ID
  to: string;         // recipient agent ID (or '*' for broadcast)
  type: 'request' | 'response' | 'status' | 'error';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};

export type AgentInfo = {
  id: string;
  role: string;        // e.g., 'code-reviewer', 'test-writer'
  status: 'idle' | 'working' | 'done' | 'error';
  currentTask?: string;
};

/**
 * Message bus for agent-to-agent communication.
 */
export class AgentMessageBus {
  private inboxes = new Map<string, AgentMessage[]>();
  private agents = new Map<string, AgentInfo>();
  private fileLocks = new Map<string, string>(); // filePath → agentId

  /** Register an agent with the bus */
  registerAgent(id: string, role: string): void {
    this.agents.set(id, { id, role, status: 'idle' });
    this.inboxes.set(id, []);
  }

  /** Unregister an agent */
  unregisterAgent(id: string): void {
    this.agents.delete(id);
    this.inboxes.delete(id);
    // Release all locks held by this agent
    for (const [file, holder] of this.fileLocks) {
      if (holder === id) this.fileLocks.delete(file);
    }
  }

  /** Send a message to a specific agent or broadcast */
  send(message: Omit<AgentMessage, 'timestamp'>): void {
    const msg: AgentMessage = { ...message, timestamp: Date.now() };

    if (msg.to === '*') {
      // Broadcast to all agents except sender
      for (const [id, inbox] of this.inboxes) {
        if (id !== msg.from) inbox.push(msg);
      }
    } else {
      const inbox = this.inboxes.get(msg.to);
      if (inbox) inbox.push(msg);
    }
  }

  /** Receive pending messages for an agent (drains inbox) */
  receive(agentId: string): AgentMessage[] {
    const inbox = this.inboxes.get(agentId);
    if (!inbox || inbox.length === 0) return [];
    const messages = [...inbox];
    inbox.length = 0;
    return messages;
  }

  /** Peek at inbox without draining */
  peek(agentId: string): AgentMessage[] {
    return [...(this.inboxes.get(agentId) ?? [])];
  }

  /** Update agent status */
  updateStatus(agentId: string, status: AgentInfo['status'], currentTask?: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.currentTask = currentTask;
    }
  }

  /** Get all registered agents */
  getAgents(): AgentInfo[] {
    return [...this.agents.values()];
  }

  /** Get a specific agent's info */
  getAgent(id: string): AgentInfo | undefined {
    return this.agents.get(id);
  }

  // ── File Locking ──

  /** Acquire a lock on a file path. Returns true if acquired, false if already locked. */
  acquireLock(agentId: string, filePath: string): boolean {
    const holder = this.fileLocks.get(filePath);
    if (holder && holder !== agentId) return false;
    this.fileLocks.set(filePath, agentId);
    return true;
  }

  /** Release a lock on a file path */
  releaseLock(agentId: string, filePath: string): void {
    const holder = this.fileLocks.get(filePath);
    if (holder === agentId) this.fileLocks.delete(filePath);
  }

  /** Release all locks held by an agent */
  releaseAllLocks(agentId: string): void {
    for (const [file, holder] of this.fileLocks) {
      if (holder === agentId) this.fileLocks.delete(file);
    }
  }

  /** Check if a file is locked (and by whom) */
  isLocked(filePath: string): { locked: boolean; holder?: string } {
    const holder = this.fileLocks.get(filePath);
    return holder ? { locked: true, holder } : { locked: false };
  }

  /** Get all current locks */
  getLocks(): Array<{ filePath: string; holder: string }> {
    return [...this.fileLocks.entries()].map(([filePath, holder]) => ({ filePath, holder }));
  }
}

/** Singleton message bus for the current process */
let globalBus: AgentMessageBus | null = null;

export function getMessageBus(): AgentMessageBus {
  if (!globalBus) globalBus = new AgentMessageBus();
  return globalBus;
}

export function resetMessageBus(): void {
  globalBus = null;
}
