# Changelog

## 1.1.0 (2026-04-11)

### Added
- **A2A HTTP Server**: POST /a2a endpoint on remote server for cross-process agent task delegation, discovery, and status queries
- **API Security Layer**: Bearer token auth, per-IP rate limiting (60/min default), tool allowlist for remote callers, X-Request-ID headers
- **Multi-Model Router**: Task-aware model selection — fast model for exploration, powerful for code review, balanced as default. Configurable via `modelRouter` in config.yaml
- **Semantic Compression**: Context window optimization with importance scoring — removes lowest-value messages first instead of oldest-first. Keeps user intent and tool decisions over assistant commentary
- **Opt-in Telemetry**: Local JSONL event logging for tool usage, errors, session stats. Default OFF. `/doctor` can show aggregate stats

### Changed
- Remote server now publishes A2A agent card on startup (auto-discovered by `/agents`)
- CORS headers include Authorization for token auth
- Context compression drops messages by importance score instead of chronological order

## 1.0.0 (2026-04-11)

### openHarness reaches v1.0

Open-source terminal coding agent — works with any LLM.

**35 tools, 10 agent roles, 633 tests, 34 slash commands.**

### Highlights since 0.11.1
- **Verification Loops**: Auto-run lint/typecheck after every file edit. Auto-detects TypeScript, ESLint, Python/ruff, Go, Rust. Configurable via `.oh/config.yaml`.
- **Agent Role System**: 10 specialized roles with tool-level isolation (code-reviewer, evaluator, planner, architect, migrator, etc.). Explicit `allowed_tools` parameter for custom filtering.
- **Progressive Tool Expansion**: 18 of 35 tools deferred (lazy-loaded), reducing system prompt by ~46%. Tools resolve on first use or via ToolSearch.
- **Cron Executor**: Background scheduler runs due tasks every 60s. Results persisted to `~/.oh/crons/history/`.
- **Hibernate-and-Wake**: Sessions save context on exit, inject wake-up summary on resume with directory change detection.
- **Global Config**: `~/.oh/config.yaml` as fallback defaults for all projects. 3-layer merge: global → project → local.
- **MCP Server Registry**: Curated catalog of 15 MCP servers. `/mcp-registry` for browsing and generating install configs.
- **Dream Consolidation**: Memory pruning on session exit with temporal decay (0.1/30 days). Defense-in-depth file deletion guard.
- **60fps Renderer**: Batched rendering at ~16ms intervals instead of per-token, reducing CPU during fast streaming.
- **Smart Init Wizard**: Auto-detects provider from env vars, MCP server selection step.
- **Plugin System**: Skills + plugins documented. `/plugins` command for discovery.
- **E2E Tests**: 9 integration tests covering the full agent loop cycle.
- **Enhanced `/doctor`**: Memory stats, cron count, verification config, Node.js version check.

### Fixed
- Agent role `suggestedTools` used wrong names (FileRead→Read, FileWrite→Write, FileEdit→Edit)
- Verification shell-escapes file paths (command injection prevention)
- Memory deletion guarded by directory boundary check
- MultiEdit verification checks all modified files
- Windows timeout detection in verification
- npm package slimmed from 2.1MB to 818KB

## 0.12.1 (2026-04-11)

### Added
- **Hibernate-and-Wake**: Sessions save context summary on exit; resumed sessions get wake-up context with previous state, working directory change warnings, and continuation guidance
- **3 New Agent Roles**: `planner` (implementation plans), `architect` (system design), `migrator` (codebase migrations) — 10 roles total
- **MCP Server Registry**: Curated catalog of 15 MCP servers with `/mcp-registry` command for browsing, searching, and generating install configs
- **Global Config Hierarchy**: `~/.oh/config.yaml` as fallback defaults for all projects; config loads global → project → local

### Fixed
- npm package size reduced from 2.1MB to 818KB (excluded test files and source maps)

## 0.12.0 (2026-04-11)

### Added
- **Verification Loops**: Auto-run lint/typecheck after file edits (Edit, Write, MultiEdit) with auto-detected or configurable rules. Supports TypeScript, ESLint, Python/ruff, Go, Rust.
- **Generator/Evaluator Split**: Agent roles now restrict sub-agent tools via `suggestedTools`. New `evaluator` role for read-only code evaluation with test running. New `allowed_tools` parameter for explicit tool filtering.
- **Dream Consolidation**: Memory pruning on session exit with temporal decay (0.1 relevance lost per 30 days of inactivity). Files below 0.1 relevance are automatically deleted.
- **Progressive Tool Expansion**: 18 of 35 tools are now deferred (lazy-loaded), reducing system prompt size by ~46%. Tools resolve on first use or via ToolSearch.
- **Cron Executor**: Background scheduler that runs due cron tasks every 60 seconds. Results persisted to `~/.oh/crons/history/`.
- **DeferredTool**: Lazy-loading wrapper for built-in tools (mirrors DeferredMcpTool pattern for MCP tools).

### Fixed
- Agent role `suggestedTools` used wrong names (`FileRead` -> `Read`, `FileWrite` -> `Write`, `FileEdit` -> `Edit`)
- Verification shell-escapes file paths to prevent command injection
- Memory deletion guarded by directory boundary check (defense-in-depth)
- MultiEdit verification now checks all modified files, not just the first

## 0.5.1 (2026-04-06)

### Fixed
- Cybergotchi panel overlapping chat text — stdout messages and Ink left column capped to `terminalWidth - panelWidth`; panel auto-hides on narrow terminals (#20)
- Duplicate thinking block in REPL JSX

## 0.5.0 (2026-04-06)

### Added
- **Permission modes**: `acceptEdits` (auto-approve file ops) and `plan` (read-only) join existing ask/trust/deny
- **Hooks system**: shell commands on `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse` events; preToolUse can block tool calls (exit code 1); configured in `.oh/config.yaml`
- **Extended thinking**: Anthropic thinking blocks, OpenAI o1/o3 reasoning tokens, Ollama `<think>` tag parsing — displayed as dimmed text above response
- **Session fork**: `--continue` flag to resume last session, `--fork <id>` to branch from existing session, `/fork` slash command
- **Provider tests**: unit tests for Ollama, OpenAI, Anthropic, LlamaCpp fetchModels/healthCheck (closes #10)
- **MCP improvements**: per-server `riskLevel` config, configurable `timeout`, auto-restart on crash
- **`llamacpp` auto-detection**: `guessProviderFromModel` recognises `.gguf` and `llamacpp` prefixes (closes #7)
- **429 rate-limit retry**: exponential backoff (2s/4s/8s) with user-visible status
- **README**: permission modes table, hooks guide, provider usage examples (closes #8)

### Changed
- `/compact` now uses smart `compressMessages` with orphan tool result cleanup instead of naive keep-last-10
- Context window tables consolidated into single `getContextWindow()` in `cost.ts`
- Sub-agents inherit parent `permissionMode` instead of hardcoding `trust`

### Fixed
- Cybergotchi panel expanding on each 500ms tick (#15)
- Cybergotchi panel overlapping chat text — capped to terminal width, auto-hides on narrow terminals (#20)
- Shell injection in `autoCommitAIEdits` (#16)
- `/model` provider mismatch — validates model is compatible with current provider (#16)
- Orphan tool results after `/compact` causing Anthropic 400 errors (#17)
- WebFetch redirect blocking — follows redirects with post-redirect SSRF host check (#17)
- `loadCybergotchiConfig()` no longer reads disk on every render (#17)

## 0.4.2 (2026-04-04)

- Fix: print banner before Ink render to eliminate frame stacking (#14)

## 0.4.1 (2026-04-03)

- Fix: surface stream errors instead of silent blank responses (#12)

## 0.4.0 (2026-04-02)

- Feat: add LM Studio provider
- Feat: add llama.cpp/GGUF provider (#6)

## 0.1.0 (2026-04-01)

Initial alpha release. TypeScript rewrite.

### Features
- Single TypeScript process with React+Ink terminal UI
- Agent loop with async generator streaming
- 5 LLM providers: Ollama, OpenAI, Anthropic, OpenRouter, OpenAI-compatible
- 7 tools: Read, Edit, Write, Bash, Glob, Grep, WebFetch (all with Zod schemas)
- Permission gate with ask/trust/deny modes and risk-based tool approval
- Tool concurrency: read-only parallel, write serial
- Project rules (.oh/RULES.md)
- Cost tracking with per-model breakdown
- Session persistence
- Project auto-detection (15+ languages, 20+ frameworks)
- Global install: `npm install -g openharness` then just `oh`
