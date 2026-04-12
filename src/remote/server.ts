/**
 * Remote server — HTTP + WebSocket server for remote agent dispatch,
 * bidirectional channels, A2A protocol, and structured event streaming.
 *
 * Endpoints:
 * - POST /dispatch  — send a prompt, get a streaming response (SSE)
 * - POST /a2a       — A2A protocol: task delegation, discovery, status
 * - GET  /status    — check server status
 * - WS   /channel   — bidirectional WebSocket channel
 *
 * Security: bearer token auth, per-IP rate limiting, tool allowlists.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Provider } from "../providers/base.js";
import {
  type A2AMessage,
  createSessionCard,
  discoverAgents,
  generateMessageId,
  publishCard,
  unpublishCard,
} from "../services/a2a.js";
import type { Tools } from "../Tool.js";
import type { PermissionMode } from "../types/permissions.js";
import { authenticateRequest, filterRemoteTools } from "./auth.js";

export type RemoteServerConfig = {
  port: number;
  provider: Provider;
  tools: Tools;
  systemPrompt: string;
  permissionMode: PermissionMode;
  model?: string;
  sessionId?: string;
};

type Channel = {
  id: string;
  ws: WebSocket;
  abortController: AbortController;
};

export class RemoteServer {
  private config: RemoteServerConfig;
  private channels = new Map<string, Channel>();
  private server: ReturnType<typeof createServer> | null = null;
  private agentCardId: string | null = null;

  constructor(config: RemoteServerConfig) {
    this.config = config;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleHttp(req, res));

      // WebSocket upgrade
      const wss = new WebSocketServer({ noServer: true });
      this.server.on("upgrade", (request, socket, head) => {
        if (request.url === "/channel") {
          wss.handleUpgrade(request, socket, head, (ws) => {
            this.handleChannel(ws);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(this.config.port, () => {
        process.stderr.write(`[remote] Server listening on http://localhost:${this.config.port}\n`);
        process.stderr.write(`[remote] Endpoints: POST /dispatch, POST /a2a, GET /status, WS /channel\n`);

        // Publish A2A agent card with HTTP endpoint
        const sessionId = this.config.sessionId ?? Date.now().toString(36);
        const card = createSessionCard(sessionId, {
          provider: this.config.provider.name,
          model: this.config.model,
          port: this.config.port,
        });
        publishCard(card);
        this.agentCardId = card.id;
        process.stderr.write(`[remote] A2A agent card published: ${card.id}\n`);

        resolve();
      });
    });
  }

  stop(): void {
    // Unpublish A2A card
    if (this.agentCardId) {
      unpublishCard(this.agentCardId);
      this.agentCardId = null;
    }
    for (const ch of this.channels.values()) {
      ch.abortController.abort();
      ch.ws.close();
    }
    this.channels.clear();
    this.server?.close();
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check (skip for /status which is a health check)
    if (req.url !== "/status") {
      const auth = authenticateRequest(req, res);
      if (!auth.allowed) {
        const status = auth.reason?.includes("Rate limit") ? 429 : 401;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: auth.reason, requestId: auth.requestId }));
        return;
      }
    }

    // ── GET /status ──
    if (req.url === "/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          provider: this.config.provider.name,
          model: this.config.model,
          channels: this.channels.size,
          agentId: this.agentCardId,
        }),
      );
      return;
    }

    // ── POST /dispatch ──
    if (req.url === "/dispatch" && req.method === "POST") {
      await this.handleDispatch(req, res);
      return;
    }

    // ── POST /a2a ──
    if (req.url === "/a2a" && req.method === "POST") {
      await this.handleA2A(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private async handleDispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    try {
      const { prompt, maxTurns } = JSON.parse(body);
      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Missing "prompt" field' }));
        return;
      }

      // Apply tool filtering for remote callers
      const tools = filterRemoteTools(this.config.tools);

      // Stream response as Server-Sent Events
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const { query } = await import("../query.js");
      const config = {
        provider: this.config.provider,
        tools,
        systemPrompt: this.config.systemPrompt,
        permissionMode: this.config.permissionMode,
        model: this.config.model,
        maxTurns: maxTurns ?? 20,
      };

      for await (const event of query(prompt, config)) {
        const data = JSON.stringify(event);
        res.write(`data: ${data}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  /**
   * A2A protocol handler — receives inter-agent messages.
   *
   * Supports:
   * - task: delegate a task to this agent
   * - discover: return this agent's capabilities
   * - status: return current state
   * - cancel: abort a running task
   */
  private async handleA2A(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    try {
      const message = JSON.parse(body) as A2AMessage;

      switch (message.payload.kind) {
        case "discover": {
          // Return our agent card
          const agents = discoverAgents();
          const self = agents.find((a) => a.id === this.agentCardId);
          const response: A2AMessage = {
            id: generateMessageId(),
            from: this.agentCardId ?? "unknown",
            to: message.from,
            type: "result",
            payload: { kind: "result", taskId: message.id, output: self ?? { error: "agent not found" } },
            timestamp: Date.now(),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        case "task": {
          // Execute the task via query loop
          const tools = filterRemoteTools(this.config.tools);
          const { query } = await import("../query.js");
          const config = {
            provider: this.config.provider,
            tools,
            systemPrompt: `[A2A Task from agent ${message.from}]\n\n${this.config.systemPrompt}`,
            permissionMode: this.config.permissionMode,
            model: this.config.model,
            maxTurns: 10,
          };

          let output = "";
          for await (const event of query(String(message.payload.input), config)) {
            if (event.type === "text_delta") output += event.content;
          }

          const response: A2AMessage = {
            id: generateMessageId(),
            from: this.agentCardId ?? "unknown",
            to: message.from,
            type: "result",
            payload: { kind: "result", taskId: message.id, output },
            timestamp: Date.now(),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        case "status": {
          const response: A2AMessage = {
            id: generateMessageId(),
            from: this.agentCardId ?? "unknown",
            to: message.from,
            type: "status",
            payload: { kind: "status", state: "idle" },
            timestamp: Date.now(),
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
          return;
        }

        default: {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown A2A message kind: ${(message.payload as any).kind}` }));
          return;
        }
      }
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private handleChannel(ws: WebSocket): void {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const abortController = new AbortController();
    const channel: Channel = { id, ws, abortController };
    this.channels.set(id, channel);

    process.stderr.write(`[remote] Channel ${id} connected\n`);

    ws.send(JSON.stringify({ type: "connected", channelId: id }));

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "dispatch") {
          const tools = filterRemoteTools(this.config.tools);
          const { query } = await import("../query.js");
          const config = {
            provider: this.config.provider,
            tools,
            systemPrompt: this.config.systemPrompt,
            permissionMode: this.config.permissionMode,
            model: this.config.model,
            maxTurns: msg.maxTurns ?? 20,
            abortSignal: abortController.signal,
          };

          for await (const event of query(msg.prompt, config)) {
            if (ws.readyState !== WebSocket.OPEN) break;
            ws.send(JSON.stringify(event));
          }
          ws.send(JSON.stringify({ type: "dispatch_complete" }));
        }

        if (msg.type === "abort") {
          abortController.abort();
          ws.send(JSON.stringify({ type: "aborted" }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) }));
      }
    });

    ws.on("close", () => {
      abortController.abort();
      this.channels.delete(id);
      process.stderr.write(`[remote] Channel ${id} disconnected\n`);
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
