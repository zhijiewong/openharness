import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type AgentCard,
  createSessionCard,
  discoverAgents,
  findAgentByName,
  findAgentsByCapability,
  generateMessageId,
  publishCard,
  readInbox,
  unpublishCard,
} from "./a2a.js";

describe("A2A protocol", () => {
  const testCard: AgentCard = {
    id: "test-agent-1",
    name: "test-agent",
    version: "1.0.0",
    capabilities: [
      { name: "code-review", description: "Review code" },
      { name: "testing", description: "Run tests" },
    ],
    endpoint: { type: "ipc", address: "/tmp/test-agent" },
    registeredAt: Date.now(),
    pid: process.pid, // Use current PID so it passes alive check
    provider: "mock",
    model: "test-model",
    workingDir: "/tmp",
  };

  afterEach(() => {
    // Clean up test cards
    try {
      unpublishCard("test-agent-1");
    } catch {
      /* ignore */
    }
    try {
      unpublishCard("test-agent-2");
    } catch {
      /* ignore */
    }
  });

  describe("publishCard / unpublishCard", () => {
    it("publishes and discovers an agent card", () => {
      publishCard(testCard);
      const agents = discoverAgents();
      const found = agents.find((a) => a.id === "test-agent-1");
      assert.ok(found, "should find published agent");
      assert.equal(found.name, "test-agent");
      assert.equal(found.capabilities.length, 2);
    });

    it("unpublishes removes the card", () => {
      publishCard(testCard);
      unpublishCard("test-agent-1");
      const agents = discoverAgents();
      assert.ok(!agents.find((a) => a.id === "test-agent-1"));
    });

    it("unpublish on nonexistent ID is safe", () => {
      unpublishCard("nonexistent-id");
    });
  });

  describe("findAgentsByCapability", () => {
    it("finds agents by capability name", () => {
      publishCard(testCard);
      const reviewers = findAgentsByCapability("code-review");
      assert.ok(reviewers.some((a) => a.id === "test-agent-1"));
    });

    it("returns empty for unknown capability", () => {
      publishCard(testCard);
      const results = findAgentsByCapability("nonexistent-capability");
      const filtered = results.filter((a) => a.id === "test-agent-1");
      assert.equal(filtered.length, 0);
    });

    it("case-insensitive matching", () => {
      publishCard(testCard);
      const results = findAgentsByCapability("CODE-REVIEW");
      assert.ok(results.some((a) => a.id === "test-agent-1"));
    });
  });

  describe("findAgentByName", () => {
    it("finds agent by name", () => {
      publishCard(testCard);
      const found = findAgentByName("test-agent");
      assert.ok(found);
      assert.equal(found.id, "test-agent-1");
    });

    it("case-insensitive matching", () => {
      publishCard(testCard);
      const found = findAgentByName("TEST-AGENT");
      assert.ok(found);
    });

    it("returns null for unknown name", () => {
      assert.equal(findAgentByName("nonexistent"), null);
    });
  });

  describe("generateMessageId", () => {
    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }
      assert.equal(ids.size, 100);
    });
  });

  describe("createSessionCard", () => {
    it("creates a valid agent card", () => {
      const card = createSessionCard("test-sess-123", { provider: "openai", model: "gpt-4o" });
      assert.equal(card.id, "oh-test-sess-123");
      assert.ok(card.name.startsWith("openharness-"));
      assert.equal(card.provider, "openai");
      assert.equal(card.model, "gpt-4o");
      assert.ok(card.capabilities.length > 0);
      assert.equal(card.pid, process.pid);
    });

    it("uses IPC endpoint by default", () => {
      const card = createSessionCard("sess-1");
      assert.equal(card.endpoint.type, "ipc");
    });

    it("uses HTTP endpoint when port provided", () => {
      const card = createSessionCard("sess-1", { port: 8080 });
      assert.equal(card.endpoint.type, "http");
      assert.equal(card.endpoint.port, 8080);
    });
  });

  describe("readInbox", () => {
    it("returns empty for nonexistent inbox", () => {
      const messages = readInbox("nonexistent-agent");
      assert.deepStrictEqual(messages, []);
    });
  });
});
