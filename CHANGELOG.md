# Changelog

## 0.1.0 (2026-04-01)

Initial alpha release.

### Features
- Agent loop with LLM-to-tool orchestration (while-true pattern)
- 5 LLM providers: Ollama, OpenAI, Anthropic, OpenRouter, OpenAI-compatible
- 7 tools: Read, Edit, Write, Bash, Glob, Grep, WebFetch
- Permission gate with ask/trust/deny modes and risk-based tool approval
- Tool concurrency: read-only tools run in parallel, write tools run serially
- Project rules (.oh/RULES.md, .oh/rules/, ~/.oh/global-rules/)
- 4 built-in skills: TDD, code-review, debug, commit
- Lifecycle hooks (PreToolUse, PostToolUse, SessionStart, etc.)
- Persistent memory system (4 types: user, feedback, project, reference)
- Cost tracking with per-model breakdown and budget enforcement
- Session persistence (save and resume conversations)
- Project auto-detection (15+ languages, 20+ frameworks)
- Sub-agent spawning with isolated context
- Smart model router (cheapest, best, local-first, balanced strategies)
- Context compression (token estimation, history truncation)
- MCP client for external tool servers
- TypeScript CLI frontend bridging to Python core via stdio
- 11 CLI commands via `oh` entry point
