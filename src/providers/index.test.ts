/**
 * Tests for createProvider factory — fallback wiring.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { invalidateConfigCache } from "../harness/config.js";
import { makeTmpDir } from "../test-helpers.js";
import { createProvider } from "./index.js";

async function withConfig(yaml: string, fn: () => Promise<void>): Promise<void> {
  const dir = makeTmpDir();
  const original = process.cwd();
  process.chdir(dir);
  try {
    mkdirSync(`${dir}/.oh`, { recursive: true });
    writeFileSync(`${dir}/.oh/config.yaml`, yaml);
    invalidateConfigCache();
    await fn();
  } finally {
    process.chdir(original);
    invalidateConfigCache();
  }
}

describe("createProvider factory — fallback wiring", () => {
  it("no fallbackProviders config → returns raw primary (no activeFallback getter)", async () => {
    await withConfig(["provider: openai", "model: gpt-4o-mini", "permissionMode: ask", ""].join("\n"), async () => {
      const { provider } = await createProvider("openai/gpt-4o-mini");
      assert.equal((provider as any).activeFallback, undefined);
    });
  });

  it("fallbackProviders configured → returns a wrapped provider with activeFallback getter (initially null)", async () => {
    await withConfig(
      [
        "provider: openai",
        "model: gpt-4o-mini",
        "permissionMode: ask",
        "fallbackProviders:",
        "  - provider: openai",
        "    model: gpt-3.5-turbo",
        "",
      ].join("\n"),
      async () => {
        const { provider } = await createProvider("openai/gpt-4o-mini");
        // The wrapped provider exposes activeFallback (null initially, before any request).
        // In JS, null has typeof "object" — this distinguishes "getter returned null"
        // from "property doesn't exist" (which would be typeof "undefined").
        assert.equal(typeof (provider as any).activeFallback, "object");
        assert.equal((provider as any).activeFallback, null);
      },
    );
  });
});
