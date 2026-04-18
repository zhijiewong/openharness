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
});
