import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveCredentials } from "../mcp/oauth-storage.js";
import { mcpLogoutHandler } from "./mcp-auth.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "oh-cmd-mcpauth-"));
}

describe("/mcp-logout", () => {
  it("wipes credentials and reports success", async () => {
    const dir = freshDir();
    try {
      await saveCredentials(dir, "linear", {
        issuerUrl: "x",
        clientInformation: { client_id: "c" },
        tokens: { access_token: "at" },
        updatedAt: new Date().toISOString(),
      });
      const res = await mcpLogoutHandler("linear", { storageDir: dir });
      assert.equal(res.handled, true);
      assert.match(res.output, /wiped/i);
      assert.match(res.output, /linear/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports no-op when no credentials exist (still handled)", async () => {
    const dir = freshDir();
    try {
      const res = await mcpLogoutHandler("nope", { storageDir: dir });
      assert.equal(res.handled, true);
      assert.match(res.output, /no credentials/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty/missing server name", async () => {
    const res = await mcpLogoutHandler("", { storageDir: "/tmp" });
    assert.equal(res.handled, true);
    assert.match(res.output, /usage:|please specify/i);
  });
});
