import assert from "node:assert/strict";
import test from "node:test";
import type { ToolContext } from "../Tool.js";
import { createMockTool } from "../test-helpers.js";
import { McpServer } from "./server.js";

const mockTools = [
  createMockTool("TestTool", { result: { output: "tool output", isError: false } }),
  createMockTool("ErrorTool", { result: { output: "boom", isError: true } }),
];
const context: ToolContext = { workingDir: "/tmp" };
const server = new McpServer(mockTools, context);

// Access handleRequest via any cast since it's private
const handle = (server as any).handleRequest.bind(server);

test("MCP server: initialize returns protocol version", async () => {
  const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, "2024-11-05");
  assert.equal(res.result.serverInfo.name, "openharness");
});

test("MCP server: notifications/initialized returns null", async () => {
  const res = await handle({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  assert.equal(res, null);
});

test("MCP server: tools/list returns all tools", async () => {
  const res = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.ok(res.result.tools.length >= 2);
  const names = res.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("TestTool"));
  assert.ok(names.includes("ErrorTool"));
});

test("MCP server: tools/call with valid tool returns content", async () => {
  const res = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "TestTool", arguments: {} },
  });
  assert.equal(res.id, 3);
  assert.ok(res.result.content.length > 0);
  assert.equal(res.result.content[0].text, "tool output");
});

test("MCP server: tools/call with unknown tool returns error", async () => {
  const res = await handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "NonExistent", arguments: {} },
  });
  assert.ok(res.error);
  assert.equal(res.error.code, -32601);
});

test("MCP server: unknown method returns error", async () => {
  const res = await handle({ jsonrpc: "2.0", id: 5, method: "foo/bar", params: {} });
  assert.ok(res.error);
  assert.equal(res.error.code, -32601);
  assert.ok(res.error.message.includes("foo/bar"));
});
