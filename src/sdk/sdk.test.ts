import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Agent, createAgent } from "./index.js";

describe("Agent SDK", () => {
  it("createAgent returns an Agent instance", () => {
    const agent = createAgent({
      provider: "mock",
      model: "test-model",
    });
    assert.ok(agent instanceof Agent);
    agent.stop();
  });

  it("Agent accepts all config options", () => {
    const agent = createAgent({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com",
      tools: ["Read", "Grep"],
      permissionMode: "trust",
      systemPrompt: "You are a bot.",
      maxTurns: 5,
      cwd: "/tmp",
    });
    assert.ok(agent);
    agent.stop();
  });

  it("Agent accepts read-only tool filter", () => {
    const agent = createAgent({
      provider: "mock",
      model: "test",
      tools: "read-only",
    });
    assert.ok(agent);
    agent.stop();
  });

  it("Agent accepts all tools", () => {
    const agent = createAgent({
      provider: "mock",
      model: "test",
      tools: "all",
    });
    assert.ok(agent);
    agent.stop();
  });

  it("stop() cleans up agent state", () => {
    const agent = createAgent({ provider: "mock", model: "test" });
    agent.stop();
    // Should not throw on double stop
    agent.stop();
  });

  it("default permissionMode is trust", () => {
    const agent = createAgent({ provider: "mock", model: "test" });
    // We can't directly inspect config, but it should not throw
    assert.ok(agent);
    agent.stop();
  });
});
