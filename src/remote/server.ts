/**
 * Remote server — HTTP + WebSocket server for remote agent dispatch,
 * bidirectional channels, and structured event streaming.
 *
 * Endpoints:
 * - POST /dispatch  — send a prompt, get a streaming response
 * - GET  /status    — check server status
 * - WS   /channel   — bidirectional WebSocket channel
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Provider } from '../providers/base.js';
import type { Tools } from '../Tool.js';
import type { PermissionMode } from '../types/permissions.js';

export type RemoteServerConfig = {
  port: number;
  provider: Provider;
  tools: Tools;
  systemPrompt: string;
  permissionMode: PermissionMode;
  model?: string;
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

  constructor(config: RemoteServerConfig) {
    this.config = config;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleHttp(req, res));

      // WebSocket upgrade
      const wss = new WebSocketServer({ noServer: true });
      this.server.on('upgrade', (request, socket, head) => {
        if (request.url === '/channel') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            this.handleChannel(ws);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(this.config.port, () => {
        process.stderr.write(`[remote] Server listening on http://localhost:${this.config.port}\n`);
        process.stderr.write(`[remote] Endpoints: POST /dispatch, GET /status, WS /channel\n`);
        resolve();
      });
    });
  }

  stop(): void {
    for (const ch of this.channels.values()) {
      ch.abortController.abort();
      ch.ws.close();
    }
    this.channels.clear();
    this.server?.close();
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        provider: this.config.provider.name,
        model: this.config.model,
        channels: this.channels.size,
      }));
      return;
    }

    if (req.url === '/dispatch' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { prompt, maxTurns } = JSON.parse(body);
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "prompt" field' }));
          return;
        }

        // Stream response as Server-Sent Events
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const { query } = await import('../query.js');
        const config = {
          provider: this.config.provider,
          tools: this.config.tools,
          systemPrompt: this.config.systemPrompt,
          permissionMode: this.config.permissionMode,
          model: this.config.model,
          maxTurns: maxTurns ?? 20,
        };

        for await (const event of query(prompt, config)) {
          const data = JSON.stringify(event);
          res.write(`data: ${data}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleChannel(ws: WebSocket): void {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const abortController = new AbortController();
    const channel: Channel = { id, ws, abortController };
    this.channels.set(id, channel);

    process.stderr.write(`[remote] Channel ${id} connected\n`);

    ws.send(JSON.stringify({ type: 'connected', channelId: id }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'dispatch') {
          const { query } = await import('../query.js');
          const config = {
            provider: this.config.provider,
            tools: this.config.tools,
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
          ws.send(JSON.stringify({ type: 'dispatch_complete' }));
        }

        if (msg.type === 'abort') {
          abortController.abort();
          ws.send(JSON.stringify({ type: 'aborted' }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      }
    });

    ws.on('close', () => {
      abortController.abort();
      this.channels.delete(id);
      process.stderr.write(`[remote] Channel ${id} disconnected\n`);
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
