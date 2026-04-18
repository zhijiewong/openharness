import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { McpServerConfig } from "../harness/config.js";
import { normalizeMcpConfig } from "./config-normalize.js";

// Strings with ${VAR} syntax stored as constants to satisfy noTemplateCurlyInString lint rule.
const bearerLinear = "Bearer " + "${LINEAR_TOKEN}";
const bearerMissing = "Bearer " + "${MISSING_TOKEN}";
const literalNotExpanded = "literal-" + "${NOT_EXPANDED}";

describe("normalizeMcpConfig", () => {
  it("infers type='stdio' when command is set and type is absent", () => {
    const out = normalizeMcpConfig({ name: "fs", command: "mcp-fs" } as McpServerConfig, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "stdio");
  });

  it("infers type='http' when url is set and type is absent", () => {
    const out = normalizeMcpConfig({ name: "api", url: "https://x/mcp" } as any, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "http");
    assert.equal((out.cfg as any).inferredFromUrl, true);
  });

  it("preserves explicit type='sse'", () => {
    const out = normalizeMcpConfig({ name: "legacy", type: "sse", url: "https://x/sse" } as McpServerConfig, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok") return;
    assert.equal(out.cfg.type, "sse");
    assert.equal((out.cfg as any).inferredFromUrl, undefined);
  });

  it("rejects configs with both command and url", () => {
    const out = normalizeMcpConfig({ name: "mix", command: "x", url: "https://x" } as any, {});
    assert.equal(out.kind, "error");
  });

  it("rejects type='http' without url", () => {
    const out = normalizeMcpConfig({ name: "x", type: "http" } as any, {});
    assert.equal(out.kind, "error");
  });

  it("rejects type='stdio' without command", () => {
    const out = normalizeMcpConfig({ name: "x", type: "stdio" } as any, {});
    assert.equal(out.kind, "error");
  });

  it("interpolates VAR placeholders in header values from provided env", () => {
    const out = normalizeMcpConfig(
      {
        name: "linear",
        type: "http",
        url: "https://x",
        headers: { Authorization: bearerLinear },
      },
      { LINEAR_TOKEN: "abc123" },
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "http") return;
    assert.equal(out.cfg.headers?.Authorization, "Bearer abc123");
  });

  it("drops the server with an error when a referenced env var is missing", () => {
    const out = normalizeMcpConfig(
      {
        name: "linear",
        type: "http",
        url: "https://x",
        headers: { Authorization: bearerMissing },
      },
      {},
    );
    assert.equal(out.kind, "error");
    if (out.kind !== "error") return;
    assert.match(out.message, /MISSING_TOKEN/);
  });

  it("passes stdio.env through without placeholder interpolation (v1 scope)", () => {
    const out = normalizeMcpConfig({ name: "fs", command: "x", env: { FOO: literalNotExpanded } }, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "stdio") return;
    assert.equal(out.cfg.env?.FOO, literalNotExpanded);
  });

  it("preserves auth='oauth' on http configs", () => {
    const out = normalizeMcpConfig(
      { name: "linear", type: "http", url: "https://x/mcp", auth: "oauth" } as McpServerConfig,
      {},
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "http") return;
    assert.equal(out.cfg.auth, "oauth");
  });

  it("preserves auth='none' on sse configs", () => {
    const out = normalizeMcpConfig(
      { name: "legacy", type: "sse", url: "https://x/sse", auth: "none" } as McpServerConfig,
      {},
    );
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "sse") return;
    assert.equal(out.cfg.auth, "none");
  });

  it("leaves auth undefined when not set (auto mode)", () => {
    const out = normalizeMcpConfig({ name: "api", type: "http", url: "https://x/mcp" } as McpServerConfig, {});
    assert.equal(out.kind, "ok");
    if (out.kind !== "ok" || out.cfg.type !== "http") return;
    assert.equal(out.cfg.auth, undefined);
  });
});
