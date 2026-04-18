/**
 * Tests for newly added slash commands: /bug, /feedback, /upgrade, /token-count,
 * /benchmark, /vim, /login, /logout, /review-pr, /pr-comments, /add-dir
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type CommandContext, processSlashCommand } from "./index.js";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    messages: [],
    model: "gpt-4o",
    providerName: "openai",
    permissionMode: "ask",
    totalCost: 0.05,
    totalInputTokens: 2000,
    totalOutputTokens: 1000,
    sessionId: "test-sess-ext",
    ...overrides,
  };
}

// ── /bug ──

test("/bug shows issue reporting instructions", async () => {
  const result = await processSlashCommand("/bug", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("issues"));
  assert.ok(result.output.includes("openharness"));
});

// ── /feedback ──

test("/feedback shows feedback instructions", async () => {
  const result = await processSlashCommand("/feedback", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("feedback"));
  assert.ok(result.output.includes("enhancement"));
});

// ── /upgrade ──

test("/upgrade shows current version and upgrade instructions", async () => {
  const result = await processSlashCommand("/upgrade", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Current version"));
  assert.ok(result.output.includes("npm"));
});

// ── /token-count ──

test("/token-count with no args shows conversation token estimate", async () => {
  const result = await processSlashCommand("/token-count", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("token"));
});

test("/token-count with text shows char/token estimate", async () => {
  const result = await processSlashCommand("/token-count hello world test", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("chars"));
  assert.ok(result.output.includes("tokens"));
});

// ── /benchmark ──

test("/benchmark with no args shows usage", async () => {
  const result = await processSlashCommand("/benchmark", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
  assert.ok(result.output.includes("BENCHMARKS"));
});

test("/benchmark with task-id returns prependToPrompt", async () => {
  const result = await processSlashCommand("/benchmark django__django-1234", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("SWE-bench"));
  assert.ok(result.prependToPrompt?.includes("django__django-1234"));
});

// ── /vim ──

test("/vim returns vim toggle signal", async () => {
  const result = await processSlashCommand("/vim", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("VIM"));
});

// ── /login ──

test("/login with no args shows usage with provider hint", async () => {
  const result = await processSlashCommand("/login", makeCtx({ providerName: "anthropic" }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("ANTHROPIC_API_KEY"));
});

test("/login with key sets it", async () => {
  const result = await processSlashCommand("/login sk-test-key-123", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("API key set"));
});

// ── /logout ──

test("/logout clears API key", async () => {
  const result = await processSlashCommand("/logout", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("cleared"));
});

// ── /review-pr ──

test("/review-pr with no args shows usage", async () => {
  const result = await processSlashCommand("/review-pr", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/review-pr with number returns prependToPrompt for gh commands", async () => {
  const result = await processSlashCommand("/review-pr 42", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("gh pr"));
  assert.ok(result.prependToPrompt?.includes("42"));
});

// ── /pr-comments ──

test("/pr-comments with no args shows usage", async () => {
  const result = await processSlashCommand("/pr-comments", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/pr-comments with number returns prependToPrompt", async () => {
  const result = await processSlashCommand("/pr-comments 99", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("99"));
  assert.ok(result.prependToPrompt?.includes("comments"));
});

// ── /add-dir ──

test("/add-dir with no args shows usage", async () => {
  const result = await processSlashCommand("/add-dir", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/add-dir with existing dir succeeds", async () => {
  const result = await processSlashCommand("/add-dir .", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Added working directory"));
});

test("/add-dir with nonexistent dir fails", async () => {
  const result = await processSlashCommand("/add-dir /nonexistent/path/xyz", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("not found"));
});

// ── /effort ──

test("/effort without args shows usage", async () => {
  const result = await processSlashCommand("/effort", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/effort with valid level sets it", async () => {
  const result = await processSlashCommand("/effort high", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("high"));
});

// ── /theme ──

test("/theme with valid value sets it", async () => {
  const result = await processSlashCommand("/theme dark", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("dark"));
});

test("/theme with invalid value shows usage", async () => {
  const result = await processSlashCommand("/theme blue", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

// ── /skill-create ──

test("/skill-create with no args shows usage", async () => {
  const result = await processSlashCommand("/skill-create", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/skill-create rejects path traversal", async () => {
  const result = await processSlashCommand("/skill-create ../evil", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Invalid"));
});

// ── /version ──

test("/version shows version number", async () => {
  const result = await processSlashCommand("/version", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("openHarness v"));
});

// ── /api-credits ──

test("/api-credits shows provider info and env hint", async () => {
  const result = await processSlashCommand("/api-credits", makeCtx({ providerName: "anthropic" }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("ANTHROPIC_API_KEY"));
  assert.ok(result.output.includes("anthropic"));
});

// ── /whoami ──

test("/whoami shows current user and provider info", async () => {
  const result = await processSlashCommand("/whoami", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Provider"));
  assert.ok(result.output.includes("openai"));
});

// ── /project ──

test("/project shows detected project info", async () => {
  const result = await processSlashCommand("/project", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Project directory"));
});

// ── /stats ──

test("/stats shows session statistics", async () => {
  const result = await processSlashCommand("/stats", makeCtx({ totalInputTokens: 5000, totalOutputTokens: 3000 }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Session Statistics"));
  assert.ok(result.output.includes("5,000"));
  assert.ok(result.output.includes("3,000"));
});

// ── /tools ──

test("/tools lists available tools", async () => {
  const result = await processSlashCommand("/tools", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Available Tools"));
  assert.ok(result.output.includes("Built-in"));
});

// ── /terminal-setup ──

test("/terminal-setup shows terminal hints", async () => {
  const result = await processSlashCommand("/terminal-setup", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Terminal Setup"));
  assert.ok(result.output.includes("Font"));
});

// ── /verbose ──

test("/verbose toggles verbose mode", async () => {
  const result = await processSlashCommand("/verbose", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Verbose"));
});

// ── /quiet ──

test("/quiet toggles quiet mode", async () => {
  const result = await processSlashCommand("/quiet", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Quiet"));
});

// ── /provider ──

test("/provider with no args shows current provider", async () => {
  const result = await processSlashCommand("/provider", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Current provider"));
  assert.ok(result.output.includes("openai"));
});

test("/provider with invalid name shows error", async () => {
  const result = await processSlashCommand("/provider badprovider", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Unknown provider"));
});

// ── /release-notes ──

test("/release-notes in non-git dir shows error", async () => {
  // Note: this test may pass or fail depending on CWD being a git repo
  const result = await processSlashCommand("/release-notes", makeCtx());
  assert.ok(result);
  // It will either show release notes or "Not a git repository"
  assert.ok(result.output.length > 0);
});

// ── /stash ──

test("/stash shows stash info", async () => {
  const result = await processSlashCommand("/stash", makeCtx());
  assert.ok(result);
  // Either shows stashes or "No stashes found" or "Not a git repository"
  assert.ok(result.output.length > 0);
});

// ── /branch ──

test("/branch with no args shows current branch", async () => {
  const result = await processSlashCommand("/branch", makeCtx());
  assert.ok(result);
  assert.ok(result.output.length > 0);
});

// ── /listen ──

test("/listen shows listening mode message", async () => {
  const result = await processSlashCommand("/listen", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Listening"));
});

// ── /truncate ──

test("/truncate with no args shows usage", async () => {
  const result = await processSlashCommand("/truncate", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/truncate with valid count removes messages", async () => {
  const msgs = [
    { role: "user" as const, content: "hello", timestamp: 1 },
    { role: "assistant" as const, content: "hi", timestamp: 2 },
    { role: "user" as const, content: "bye", timestamp: 3 },
  ];
  const result = await processSlashCommand("/truncate 1", makeCtx({ messages: msgs as any }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Truncated 1"));
  assert.equal(result.compactedMessages?.length, 2);
});

// ── /search ──

test("/search with no args shows usage", async () => {
  const result = await processSlashCommand("/search", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/search with term finds matching messages", async () => {
  const msgs = [
    { role: "user" as const, content: "Tell me about TypeScript", timestamp: 1 },
    { role: "assistant" as const, content: "TypeScript is great", timestamp: 2 },
    { role: "user" as const, content: "Thanks", timestamp: 3 },
  ];
  const result = await processSlashCommand("/search typescript", makeCtx({ messages: msgs as any }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("2 message(s)"));
});

test("/search with no matches reports none", async () => {
  const msgs = [{ role: "user" as const, content: "hello", timestamp: 1 }];
  const result = await processSlashCommand("/search zzzznonexistent", makeCtx({ messages: msgs as any }));
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No messages matching"));
});

// ── /summarize ──

test("/summarize with empty conversation", async () => {
  const result = await processSlashCommand("/summarize", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("No messages"));
});

test("/summarize with messages returns prependToPrompt", async () => {
  const msgs = [{ role: "user" as const, content: "test", timestamp: 1 }];
  const result = await processSlashCommand("/summarize", makeCtx({ messages: msgs as any }));
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("Summarize"));
});

// ── /explain ──

test("/explain with no args shows usage", async () => {
  const result = await processSlashCommand("/explain", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/explain with topic returns prependToPrompt", async () => {
  const result = await processSlashCommand("/explain src/index.ts", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("src/index.ts"));
});

// ── /fix ──

test("/fix with no args shows usage", async () => {
  const result = await processSlashCommand("/fix", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, true);
  assert.ok(result.output.includes("Usage"));
});

test("/fix with issue returns prependToPrompt", async () => {
  const result = await processSlashCommand("/fix broken import in utils.ts", makeCtx());
  assert.ok(result);
  assert.equal(result.handled, false);
  assert.ok(result.prependToPrompt?.includes("broken import in utils.ts"));
});
