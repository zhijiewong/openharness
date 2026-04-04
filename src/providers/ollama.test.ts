import test from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "./ollama.js";

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

test("OllamaProvider.fetchModels() returns ModelInfo array from /api/tags", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });
  const mockData = {
    models: [
      { name: "llama3.1:latest", details: { families: [] } },
      { name: "mistral:7b", details: { families: ["llama"] } },
    ],
  };

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    assert.equal(url, "http://localhost:11434/api/tags");
    return mockResponse(mockData);
  };
  try {
    const models = await provider.fetchModels();
    assert.equal(models.length, 2);
    assert.equal(models[0].id, "llama3.1:latest");
    assert.equal(models[0].provider, "ollama");
    assert.equal(models[0].contextWindow, 128_000);
    assert.equal(models[0].supportsTools, true);
    assert.equal(models[0].supportsStreaming, true);
    assert.equal(models[0].supportsVision, false);
    assert.equal(models[0].inputCostPerMtok, 0);
    assert.equal(models[0].outputCostPerMtok, 0);
    assert.equal(models[1].id, "mistral:7b");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.fetchModels() detects vision support via clip family", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });
  const mockData = {
    models: [
      { name: "llava:13b", details: { families: ["llama", "clip"] } },
      { name: "regular:7b", details: { families: ["llama"] } },
    ],
  };

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse(mockData);
  try {
    const models = await provider.fetchModels();
    assert.equal(models[0].supportsVision, true);
    assert.equal(models[1].supportsVision, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.fetchModels() detects vision support via llava family", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });
  const mockData = {
    models: [
      { name: "bakllava:latest", details: { families: ["llava"] } },
    ],
  };

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse(mockData);
  try {
    const models = await provider.fetchModels();
    assert.equal(models[0].supportsVision, true);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.fetchModels() returns empty array on non-OK response", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({}, 503);
  try {
    const models = await provider.fetchModels();
    assert.deepEqual(models, []);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.fetchModels() returns empty array on fetch error", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const models = await provider.fetchModels();
    assert.deepEqual(models, []);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.healthCheck() returns true for 200 OK", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({ models: [] }, 200);
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, true);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.healthCheck() returns false for 503", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => mockResponse({}, 503);
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("OllamaProvider.healthCheck() returns false on fetch error", async () => {
  const provider = new OllamaProvider({ name: "ollama", baseUrl: "http://localhost:11434" });

  const savedFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const healthy = await provider.healthCheck();
    assert.equal(healthy, false);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
