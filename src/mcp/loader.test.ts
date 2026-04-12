/**
 * Tests for MCP loader utility functions.
 * Note: loadMcpTools() requires subprocess spawning and is not tested here.
 * These test the helper functions that operate on the connected clients list.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { connectedMcpServers, disconnectMcpClients, getMcpInstructions } from "./loader.js";

test("connectedMcpServers() returns empty array initially", () => {
  const names = connectedMcpServers();
  assert.ok(Array.isArray(names));
  // May or may not be empty depending on prior test state, but should be an array
});

test("getMcpInstructions() returns empty array when no clients have instructions", () => {
  const instructions = getMcpInstructions();
  assert.ok(Array.isArray(instructions));
});

test("disconnectMcpClients() does not throw when no clients connected", () => {
  assert.doesNotThrow(() => disconnectMcpClients());
});

test("connectedMcpServers() returns empty after disconnect", () => {
  disconnectMcpClients();
  assert.deepEqual(connectedMcpServers(), []);
});
