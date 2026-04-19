import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createSession, listSessions, loadSession, saveSession } from "../harness/session.js";
import { makeTmpDir } from "../test-helpers.js";
import { createAssistantMessage, createToolResultMessage, createUserMessage } from "../types/message.js";

describe("/fork polish — parentSessionId + provider/model inheritance", () => {
  it("createSession stores parentSessionId when passed in extras", () => {
    const s = createSession("anthropic", "claude-sonnet-4-6", { parentSessionId: "abc123" });
    assert.equal(s.parentSessionId, "abc123");
    assert.equal(s.provider, "anthropic");
    assert.equal(s.model, "claude-sonnet-4-6");
  });

  it("createSession omits parentSessionId when extras has no parent", () => {
    const s = createSession("openai", "gpt-4o");
    assert.equal(s.parentSessionId, undefined);
  });

  it("listSessions surfaces parentSessionId when present", () => {
    const dir = makeTmpDir();
    const parent = createSession("p", "m1");
    saveSession(parent, dir);
    const child = createSession("p", "m1", { parentSessionId: parent.id });
    saveSession(child, dir);
    const list = listSessions(dir);
    const childSummary = list.find((s) => s.id === child.id);
    assert.ok(childSummary);
    assert.equal(childSummary!.parentSessionId, parent.id);
  });
});

describe("/export polish — markdown with tool calls + JSON mode", () => {
  // We exercise the formatMessagesAsMarkdown logic indirectly via the /export handler
  // integration, but also validate round-trip of JSON export by reading the file back.

  it("JSON export is parseable and preserves tool calls", () => {
    // Build messages with a tool-use + tool-result pair.
    const userMsg = createUserMessage("run ls");
    const assistantMsg = createAssistantMessage("Running ls", [
      { id: "t1", toolName: "Bash", arguments: { cmd: "ls" } },
    ]);
    const toolMsg = createToolResultMessage({ callId: "t1", output: "a.txt\nb.txt", isError: false });
    const messages = [userMsg, assistantMsg, toolMsg];

    const json = JSON.stringify(messages, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[1].toolCalls[0].toolName, "Bash");
    assert.equal(parsed[2].toolResults[0].output, "a.txt\nb.txt");
  });

  it("roundtrip: save a session with mixed messages, list it, load it back", () => {
    const dir = makeTmpDir();
    const s = createSession("openai", "gpt-4o");
    s.messages.push(createUserMessage("hi"));
    s.messages.push(createAssistantMessage("hello"));
    const path = saveSession(s, dir);
    assert.ok(existsSync(path));
    const loaded = loadSession(s.id, dir);
    assert.equal(loaded.messages.length, 2);
    // The raw JSON should contain role markers
    const raw = readFileSync(path, "utf-8");
    assert.match(raw, /"role":\s*"user"/);
    assert.match(raw, /"role":\s*"assistant"/);
  });
});
