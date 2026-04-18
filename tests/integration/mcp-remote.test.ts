/**
 * Remote MCP end-to-end smoke test.
 * Opt-in: runs only when OH_INTEGRATION=1.
 *
 * Starts an in-process Streamable HTTP MCP server using the SDK, connects
 * via OH's McpClient with type: "http", calls listTools() and callTool().
 *
 * Run:
 *   OH_INTEGRATION=1 npx tsx --test tests/integration/mcp-remote.test.ts
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpClient } from "../../src/mcp/client.js";

const RUN = process.env.OH_INTEGRATION === "1";

describe("remote MCP (Streamable HTTP) — integration", { skip: !RUN }, () => {
  it("lists tools and calls a tool over HTTP", async () => {
    // --- spin up server ---
    // Each session gets its own McpServer + transport pair because the SDK's
    // Protocol base class allows only one active transport at a time.
    function makeServer(): McpServer {
      const s = new McpServer(
        { name: "itest", version: "0.0.0" },
        { capabilities: { tools: {} } },
      );
      s.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "echo",
            description: "echoes input",
            inputSchema: {
              type: "object",
              properties: { msg: { type: "string" } },
              required: ["msg"],
            },
          },
        ],
      }));
      s.setRequestHandler(CallToolRequestSchema, async (req) => ({
        content: [{ type: "text", text: `echo:${(req.params.arguments as any).msg}` }],
      }));
      return s;
    }

    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const http = createServer(async (req, res) => {
      // On the first request there is no mcp-session-id header; the transport
      // generates and sends one. On subsequent requests the client echoes it back.
      const sid = req.headers["mcp-session-id"] as string | undefined;
      let t = sid ? sessions.get(sid) : undefined;
      if (!t) {
        let assignedTransport: StreamableHTTPServerTransport;
        assignedTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => globalThis.crypto.randomUUID(),
          onsessioninitialized: (assignedId: string) => {
            sessions.set(assignedId, assignedTransport);
          },
        });
        t = assignedTransport;
        await makeServer().connect(t);
      }
      await t.handleRequest(req, res);
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const port = (http.address() as AddressInfo).port;

    try {
      // --- connect OH client ---
      const client = await McpClient.connect({
        name: "itest",
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
      });

      const tools = await client.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0]!.name, "echo");

      const result = await client.callTool("echo", { msg: "hello" });
      assert.equal(result, "echo:hello");

      client.disconnect();
    } finally {
      http.close();
    }
  });

  it("completes OAuth flow end-to-end (DCR + PKCE + token exchange)", async () => {
    const { createServer: createHttpServer } = await import("node:http");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: pjoin } = await import("node:path");

    // Body helper for form/json POSTs
    async function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, string>> {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const ct = req.headers["content-type"] ?? "";
      if (ct.includes("application/json")) return JSON.parse(raw) as Record<string, string>;
      if (ct.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(raw));
      }
      return {};
    }

    const storageDir = mkdtempSync(pjoin(tmpdir(), "oh-oauth-itest-"));

    // --- Minimal in-process OAuth + MCP combined server ---
    // The SDK discovers auth metadata at <serverBase>/.well-known/oauth-authorization-server
    // (fallback when no resource_metadata in WWW-Authenticate).  Serving everything from one
    // port keeps the test simple: the MCP server returns 401 on missing/invalid tokens, AND
    // also handles the OAuth well-known/register/authorize/token endpoints.
    const ISSUED_TOKEN = "access-token-12345";
    let issuedCode: string | null = null;

    // --- MCP tool server factory ---
    function makeMcpServer(): import("@modelcontextprotocol/sdk/server/index.js").Server {
      const s = new McpServer(
        { name: "oauth-itest", version: "0.0.0" },
        { capabilities: { tools: {} } },
      );
      s.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "echo",
            description: "echoes input",
            inputSchema: {
              type: "object",
              properties: { msg: { type: "string" } },
              required: ["msg"],
            },
          },
        ],
      }));
      s.setRequestHandler(CallToolRequestSchema, async (req) => ({
        content: [{ type: "text", text: `echo:${(req.params.arguments as Record<string, unknown>).msg as string}` }],
      }));
      return s;
    }

    const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

    // Single server that acts as both OAuth AS and MCP endpoint.
    // OAuth paths are unauthenticated; /mcp path requires Bearer token.
    const mcpServer = createHttpServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const base = `http://${req.headers.host}`;
      res.setHeader("content-type", "application/json");

      // --- OAuth authorization-server metadata (RFC 8414) ---
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.end(
          JSON.stringify({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            registration_endpoint: `${base}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
        return;
      }

      // --- Dynamic Client Registration (RFC 7591) ---
      if (url.pathname === "/register" && req.method === "POST") {
        const body = await readBody(req);
        // Echo back all fields + assign a client_id
        res.end(
          JSON.stringify({
            ...body,
            client_id: "dyn-client",
          }),
        );
        return;
      }

      // --- Authorization endpoint: auto-approves, issues a code ---
      if (url.pathname === "/authorize") {
        issuedCode = "auth-code-xyz";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        res.statusCode = 302;
        res.setHeader("location", `${redirectUri}?code=${issuedCode}&state=${state}`);
        res.end();
        return;
      }

      // --- Token endpoint: exchanges code for bearer token ---
      if (url.pathname === "/token" && req.method === "POST") {
        const body = await readBody(req);
        if (body.grant_type === "authorization_code" && body.code === issuedCode) {
          res.end(
            JSON.stringify({
              access_token: ISSUED_TOKEN,
              token_type: "Bearer",
              expires_in: 3600,
              refresh_token: "rt-9999",
            }),
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }

      // --- MCP endpoint: requires valid Bearer token ---
      if (url.pathname === "/mcp") {
        const authHeader = req.headers.authorization ?? "";
        if (!authHeader.startsWith(`Bearer ${ISSUED_TOKEN}`)) {
          // Returning 401 with no resource_metadata forces the SDK to fall back to
          // using THIS server's base URL as the authorization server — which works
          // because we serve /.well-known/oauth-authorization-server above.
          res.statusCode = 401;
          res.setHeader("www-authenticate", "Bearer");
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        const sid = req.headers["mcp-session-id"] as string | undefined;
        let t = sid ? mcpSessions.get(sid) : undefined;
        if (!t) {
          let assignedTransport: StreamableHTTPServerTransport;
          assignedTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => globalThis.crypto.randomUUID(),
            onsessioninitialized: (assignedId: string) => {
              mcpSessions.set(assignedId, assignedTransport);
            },
          });
          t = assignedTransport;
          await makeMcpServer().connect(t);
        }
        await t.handleRequest(req, res);
        return;
      }

      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((r) => mcpServer.listen(0, "127.0.0.1", r));
    const mcpPort = (mcpServer.address() as import("node:net").AddressInfo).port;

    // --- Fake browser: simulate user approving by following the authorize redirect ---
    const fakeOpen = async (url: string): Promise<void> => {
      const resp = await fetch(url, { redirect: "manual" });
      const loc = resp.headers.get("location");
      if (loc) await fetch(loc);
    };

    try {
      // First connect — triggers OAuth flow
      const client = await McpClient.connect(
        {
          name: "oauth-itest",
          type: "http",
          url: `http://127.0.0.1:${mcpPort}/mcp`,
          auth: "oauth",
        } as Parameters<typeof McpClient.connect>[0],
        { openFn: fakeOpen, storageDir },
      );

      const tools = await client.listTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0]!.name, "echo");

      const result = await client.callTool("echo", { msg: "oauth-hello" });
      assert.equal(result, "echo:oauth-hello");

      // Verify credentials were persisted to the isolated temp dir
      const { loadCredentials } = await import("../../src/mcp/oauth-storage.js");
      const creds = await loadCredentials(storageDir, "oauth-itest");
      assert.ok(creds, "credentials should have been saved");
      assert.equal(creds.tokens.access_token, ISSUED_TOKEN);

      client.disconnect();
    } finally {
      mcpServer.close();
      rmSync(storageDir, { recursive: true, force: true });
    }
  });
});
