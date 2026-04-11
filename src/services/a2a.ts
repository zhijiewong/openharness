/**
 * A2A Protocol — Agent-to-Agent discovery and routing.
 *
 * Enables agents running in separate processes (or machines) to:
 * - Advertise their capabilities via Agent Cards
 * - Discover other agents via a shared registry
 * - Route messages to agents by name or capability
 * - Delegate tasks with typed request/response
 *
 * Registry is file-based (~/.oh/agents/) for same-machine agents.
 * Each running agent writes a card file on startup and removes it on exit.
 *
 * Based on the emerging A2A (Agent-to-Agent) protocol standard.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AGENT_REGISTRY_DIR = join(homedir(), '.oh', 'agents');

// ── Types ──

export type AgentCard = {
  /** Unique agent instance ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Agent version */
  version: string;
  /** What this agent can do */
  capabilities: AgentCapability[];
  /** How to reach this agent */
  endpoint: AgentEndpoint;
  /** When this card was published */
  registeredAt: number;
  /** PID of the agent process */
  pid: number;
  /** Provider and model info */
  provider?: string;
  model?: string;
  /** Working directory */
  workingDir?: string;
};

export type AgentCapability = {
  /** Capability identifier (e.g., 'code-review', 'test-generation') */
  name: string;
  /** Human description */
  description: string;
  /** Input schema (JSON Schema format) */
  inputSchema?: Record<string, unknown>;
  /** Output schema */
  outputSchema?: Record<string, unknown>;
};

export type AgentEndpoint = {
  /** Transport type */
  type: 'http' | 'ipc' | 'stdio';
  /** Address (URL for http, socket path for ipc, pid for stdio) */
  address: string;
  /** Port for HTTP transport */
  port?: number;
};

export type A2AMessage = {
  /** Message ID */
  id: string;
  /** Source agent ID */
  from: string;
  /** Target agent ID or capability name */
  to: string;
  /** Message type */
  type: 'task' | 'result' | 'status' | 'cancel' | 'discover';
  /** Payload */
  payload: A2APayload;
  /** Timestamp */
  timestamp: number;
};

export type A2APayload =
  | { kind: 'task'; capability: string; input: unknown; timeout?: number }
  | { kind: 'result'; taskId: string; output: unknown; error?: string }
  | { kind: 'status'; state: 'idle' | 'working' | 'done' | 'error'; progress?: string }
  | { kind: 'cancel'; taskId: string; reason?: string }
  | { kind: 'discover'; filter?: { capability?: string; name?: string } };

// ── Registry Operations ──

/** Publish an agent card to the shared registry */
export function publishCard(card: AgentCard): void {
  mkdirSync(AGENT_REGISTRY_DIR, { recursive: true });
  const filePath = join(AGENT_REGISTRY_DIR, `${card.id}.json`);
  writeFileSync(filePath, JSON.stringify(card, null, 2));
}

/** Remove an agent card from the registry */
export function unpublishCard(agentId: string): void {
  const filePath = join(AGENT_REGISTRY_DIR, `${agentId}.json`);
  try { unlinkSync(filePath); } catch { /* ignore */ }
}

/** Discover all registered agents */
export function discoverAgents(): AgentCard[] {
  if (!existsSync(AGENT_REGISTRY_DIR)) return [];

  const cards: AgentCard[] = [];
  for (const file of readdirSync(AGENT_REGISTRY_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const raw = readFileSync(join(AGENT_REGISTRY_DIR, file), 'utf-8');
      const card = JSON.parse(raw) as AgentCard;

      // Check if the agent process is still alive
      if (isProcessAlive(card.pid)) {
        cards.push(card);
      } else {
        // Stale card — clean up
        try { unlinkSync(join(AGENT_REGISTRY_DIR, file)); } catch { /* ignore */ }
      }
    } catch { /* skip malformed cards */ }
  }

  return cards;
}

/** Find agents by capability name */
export function findAgentsByCapability(capabilityName: string): AgentCard[] {
  return discoverAgents().filter(card =>
    card.capabilities.some(c => c.name.toLowerCase() === capabilityName.toLowerCase()),
  );
}

/** Find an agent by name */
export function findAgentByName(name: string): AgentCard | null {
  return discoverAgents().find(c => c.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// ── Message Routing ──

/**
 * Route a message to an agent.
 * For HTTP endpoints: sends via fetch.
 * For IPC/stdio: writes to the agent's inbox file.
 */
export async function routeMessage(message: A2AMessage): Promise<A2AMessage | null> {
  // Find the target agent
  let targetCard: AgentCard | null = null;

  // Try by agent ID first
  const agents = discoverAgents();
  targetCard = agents.find(a => a.id === message.to) ?? null;

  // Try by name
  if (!targetCard) {
    targetCard = agents.find(a => a.name.toLowerCase() === message.to.toLowerCase()) ?? null;
  }

  // Try by capability
  if (!targetCard && message.type === 'task' && message.payload.kind === 'task') {
    const capable = findAgentsByCapability(message.payload.capability);
    if (capable.length > 0) targetCard = capable[0]!;
  }

  if (!targetCard) return null;

  // Route based on endpoint type
  switch (targetCard.endpoint.type) {
    case 'http': {
      try {
        const url = `${targetCard.endpoint.address}${targetCard.endpoint.port ? ':' + targetCard.endpoint.port : ''}/a2a`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          return await res.json() as A2AMessage;
        }
      } catch { /* delivery failed */ }
      return null;
    }

    case 'ipc': {
      // File-based inbox for local IPC
      const inboxDir = join(AGENT_REGISTRY_DIR, 'inboxes', targetCard.id);
      mkdirSync(inboxDir, { recursive: true });
      const msgFile = join(inboxDir, `${message.id}.json`);
      writeFileSync(msgFile, JSON.stringify(message, null, 2));
      return null; // Async — no immediate response
    }

    default:
      return null;
  }
}

/** Read pending messages from an agent's inbox */
export function readInbox(agentId: string): A2AMessage[] {
  const inboxDir = join(AGENT_REGISTRY_DIR, 'inboxes', agentId);
  if (!existsSync(inboxDir)) return [];

  const messages: A2AMessage[] = [];
  for (const file of readdirSync(inboxDir).filter(f => f.endsWith('.json'))) {
    try {
      const raw = readFileSync(join(inboxDir, file), 'utf-8');
      messages.push(JSON.parse(raw) as A2AMessage);
      // Remove after reading
      unlinkSync(join(inboxDir, file));
    } catch { /* skip */ }
  }

  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Helpers ──

/** Check if a process is still alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence only
    return true;
  } catch {
    return false;
  }
}

/** Generate a unique message ID */
export function generateMessageId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Create a standard agent card for the current openHarness session */
export function createSessionCard(
  sessionId: string,
  opts: { provider?: string; model?: string; port?: number } = {},
): AgentCard {
  return {
    id: `oh-${sessionId}`,
    name: `openharness-${sessionId.slice(0, 6)}`,
    version: '1.0.0',
    capabilities: [
      { name: 'code-generation', description: 'Generate, edit, and review code' },
      { name: 'code-review', description: 'Review code for bugs and quality' },
      { name: 'test-generation', description: 'Write tests for existing code' },
      { name: 'file-operations', description: 'Read, write, search files' },
      { name: 'bash-execution', description: 'Run shell commands' },
    ],
    endpoint: opts.port
      ? { type: 'http', address: 'http://localhost', port: opts.port }
      : { type: 'ipc', address: join(AGENT_REGISTRY_DIR, 'inboxes', `oh-${sessionId}`) },
    registeredAt: Date.now(),
    pid: process.pid,
    provider: opts.provider,
    model: opts.model,
    workingDir: process.cwd(),
  };
}
