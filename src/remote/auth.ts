/**
 * API security layer — auth, rate limiting, and tool access control
 * for the remote server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Tools } from '../Tool.js';
import { readOhConfig } from '../harness/config.js';

// ── Rate Limiting ──

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const rateLimitMap = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000; // 1 minute sliding window

/** Check if a request is within rate limits. Returns true if allowed. */
export function checkRateLimit(ip: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= maxPerMinute) return false;

  entry.count++;
  return true;
}

// ── Token Auth ──

/** Validate a bearer token against configured tokens. Returns true if valid. */
export function validateToken(authHeader: string | undefined): boolean {
  const config = readOhConfig();
  const tokens = config?.remote?.tokens;

  // No tokens configured = no auth required (open access)
  if (!tokens || tokens.length === 0) return true;

  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  return tokens.includes(token);
}

// ── Tool Filtering ──

/** Filter tools based on remote config allowlist */
export function filterRemoteTools(tools: Tools): Tools {
  const config = readOhConfig();
  const allowed = config?.remote?.allowedTools;

  if (!allowed || allowed.length === 0) return tools;

  const allowSet = new Set(allowed.map(n => n.toLowerCase()));
  const filtered = tools.filter(t => allowSet.has(t.name.toLowerCase()));
  return filtered.length > 0 ? filtered : tools; // fallback to all if filter empties
}

// ── Request ID ──

let requestCounter = 0;

/** Generate a unique request ID */
export function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${(++requestCounter).toString(36)}`;
}

// ── Middleware ──

export type AuthResult = {
  allowed: boolean;
  reason?: string;
  requestId: string;
};

/**
 * Run auth checks on an incoming request.
 * Returns allowed=true if the request should proceed.
 */
export function authenticateRequest(req: IncomingMessage, res: ServerResponse): AuthResult {
  const requestId = generateRequestId();
  res.setHeader('X-Request-ID', requestId);

  // Token auth
  if (!validateToken(req.headers.authorization)) {
    return { allowed: false, reason: 'Invalid or missing bearer token', requestId };
  }

  // Rate limiting
  const config = readOhConfig();
  const rateLimit = config?.remote?.rateLimit ?? 60; // default 60/min
  const ip = req.socket.remoteAddress ?? 'unknown';

  if (!checkRateLimit(ip, rateLimit)) {
    return { allowed: false, reason: 'Rate limit exceeded', requestId };
  }

  return { allowed: true, requestId };
}
