import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProtocolError, RemoteAuthRequiredError, UnreachableError } from "./transport.js";

describe("transport error types", () => {
  it("RemoteAuthRequiredError carries name, realm, and instance-of check", () => {
    const err = new RemoteAuthRequiredError("linear", 'Bearer realm="linear-mcp"');
    assert.ok(err instanceof RemoteAuthRequiredError);
    assert.ok(err instanceof Error);
    assert.equal(err.serverName, "linear");
    assert.equal(err.wwwAuthenticate, 'Bearer realm="linear-mcp"');
    assert.match(err.message, /linear/);
    assert.match(err.message, /OAuth flow is not yet supported/);
  });

  it("UnreachableError wraps cause", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new UnreachableError("api", cause);
    assert.ok(err instanceof UnreachableError);
    assert.match(err.message, /api/);
    assert.match(err.message, /ECONNREFUSED/);
  });

  it("ProtocolError wraps cause", () => {
    const err = new ProtocolError("svr", new Error("bad frame"));
    assert.ok(err instanceof ProtocolError);
    assert.match(err.message, /svr/);
    assert.match(err.message, /bad frame/);
  });
});
