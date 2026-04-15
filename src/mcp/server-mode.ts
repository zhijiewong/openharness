/**
 * MCP Server Mode — expose openHarness tools as an MCP server over stdio.
 * Run: oh mcp-server
 *
 * Thin entry-point that wires getAllTools() into the McpServer class.
 * Each message is a JSON-RPC 2.0 object on a single newline-delimited line.
 * stdin → requests, stdout → responses, stderr → logs.
 */

import { getAllTools } from "../tools.js";
import { McpServer } from "./server.js";

export async function startMcpServer(): Promise<void> {
  const tools = getAllTools();
  const context = { workingDir: process.cwd() };
  const server = new McpServer(tools, context);
  server.start();
}
