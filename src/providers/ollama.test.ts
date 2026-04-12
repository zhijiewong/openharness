import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { OllamaProvider } from "./ollama.js";

const originalFetch = globalThis.fetch;

test("fetchModels returns models from /api/tags", async () => {
  globalThis.fetch = mock.fn(
    async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "llama3:latest", details: { families: ["llama"] } },
            { name: "llava:latest", details: { families: ["llama", "clip"] } },
          ],
        }),
        { status: 200 },
      ),
  ) as any;

  const provider = new OllamaProvider({ name: "ollama", defaultModel: "llama3" });
  const models = await provider.fetchModels();

  assert.equal(models.length, 2);
  assert.equal(models[0]!.id, "llama3:latest");
  assert.equal(models[0]!.supportsVision, false);
  assert.equal(models[1]!.id, "llava:latest");
  assert.equal(models[1]!.supportsVision, true);

  globalThis.fetch = originalFetch;
});

test("fetchModels returns [] on network error", async () => {
  globalThis.fetch = mock.fn(async () => {
    throw new Error("ECONNREFUSED");
  }) as any;

  const provider = new OllamaProvider({ name: "ollama", defaultModel: "llama3" });
  const models = await provider.fetchModels();
  assert.deepEqual(models, []);

  globalThis.fetch = originalFetch;
});

test("healthCheck returns true when server responds", async () => {
  globalThis.fetch = mock.fn(async () => new Response("{}", { status: 200 })) as any;

  const provider = new OllamaProvider({ name: "ollama", defaultModel: "llama3" });
  assert.equal(await provider.healthCheck(), true);

  globalThis.fetch = originalFetch;
});

test("healthCheck returns false on error", async () => {
  globalThis.fetch = mock.fn(async () => {
    throw new Error("ECONNREFUSED");
  }) as any;

  const provider = new OllamaProvider({ name: "ollama", defaultModel: "llama3" });
  assert.equal(await provider.healthCheck(), false);

  globalThis.fetch = originalFetch;
});
