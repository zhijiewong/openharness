import test from "node:test";
import assert from "node:assert/strict";
import { LlamaCppProvider } from "./llamacpp.js";

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

test("LlamaCppProvider.fetchModels() returns ModelInfo array from /v1/models", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });
  const mockData = {
    data: [
      { id: "llama3-8b" },
      { id: "mistral-7b" },
    ],
  };

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    assert.equal(url, "http://localhost:8080/v1/models");
    return mockResponse(mockData);
  };
  try {
    const models = await provider.fetchModels();
    assert.equal(models.length, 2);
    assert.equal(models[0].id, "llama3-8b");
    assert.equal(models[0].provider, "llamacpp");
    assert.equal(models[0].contextWindow, 128_000);
    assert.equal(models[0].supportsTools, true);
    assert.equal(models[0].supportsStreaming, true);
    assert.equal(models[0].supportsVision, false);
    assert.equal(models[0].inputCostPerMtok, 0);
    assert.equal(models[0].outputCostPerMtok, 0);
    assert.equal(models[1].id, "mistral-7b");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.fetchModels() strips /v1 suffix from baseUrl before fetching", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080/v1" });
  const mockData = { data: [{ id: "model-a" }] };

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    // Should NOT produce /v1/v1/models
    assert.equal(url, "http://localhost:8080/v1/models");
    return mockResponse(mockData);
  };
  try {
    const models = await provider.fetchModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "model-a");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.fetchModels() returns empty array on non-OK response", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({}, 503);
  try {
    const models = await provider.fetchModels();
    assert.deepEqual(models, []);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.fetchModels() returns empty array on fetch error", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const models = await provider.fetchModels();
    assert.deepEqual(models, []);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.healthCheck() returns true for 200 OK", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({}, 200);
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, true);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.healthCheck() returns false for 503", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({}, 503);
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("LlamaCppProvider.healthCheck() returns false on fetch error", async () => {
  const provider = new LlamaCppProvider({ name: "llamacpp", baseUrl: "http://localhost:8080" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
