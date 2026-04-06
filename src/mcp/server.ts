/**
 * MCP Server — expose openHarness tools as an MCP server over stdio.
 *
 * Other MCP clients (IDE extensions, other agents) can connect and use
 * openHarness's tools (Bash, Read, Write, Edit, Glob, Grep, etc.)
 */

import { createInterface } from 'node:readline';
import type { Tool, Tools, ToolContext } from '../Tool.js';
import { zodToJsonSchemaSimple } from './schema.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: any;
  error?: { code: number; message: string };
}

export class McpServer {
  private tools: Tools;
  private context: ToolContext;

  constructor(tools: Tools, context: ToolContext) {
    this.tools = tools;
    this.context = context;
  }

  /** Start listening on stdio */
  start(): void {
    const rl = createInterface({ input: process.stdin });

    rl.on('line', async (line) => {
      try {
        const req: JsonRpcRequest = JSON.parse(line);
        const res = await this.handleRequest(req);
        if (res && req.id !== undefined) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch {
        // Ignore parse errors
      }
    });

    process.stderr.write('[mcp-server] OpenHarness MCP server ready\n');
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'openharness', version: '0.5.1' },
            capabilities: { tools: { listChanged: false } },
          },
        };

      case 'notifications/initialized':
        return null; // notification, no response

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.tools.map(t => ({
              name: t.name,
              description: t.prompt().slice(0, 200),
              inputSchema: zodToJsonSchemaSimple(t.inputSchema),
            })),
          },
        };

      case 'tools/call': {
        const { name, arguments: args } = req.params ?? {};
        const tool = this.tools.find(t => t.name === name);
        if (!tool) {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } };
        }

        const parsed = tool.inputSchema.safeParse(args);
        if (!parsed.success) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: parsed.error.message } };
        }

        try {
          const result = await tool.call(parsed.data, this.context);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result.output }],
              isError: result.isError,
            },
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
          };
        }
      }

      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${req.method}` } };
    }
  }
}
