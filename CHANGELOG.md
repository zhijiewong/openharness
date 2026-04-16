# Changelog

## 2.7.0 (2026-04-16) — Full Parity

### Added
- **19 new slash commands**: /version, /whoami, /project, /stats, /tools, /api-credits, /terminal-setup, /verbose, /quiet, /provider, /release-notes, /stash, /branch, /listen, /truncate, /search, /summarize, /explain, /fix (78 total — near Claude Code parity)
- **22 new tool tests**: TodoWrite, Memory, TaskCreate/Update/List, ToolSearch, EnterPlanMode, ExitPlanMode, KillProcess (865 tests total)

### Changed
- **Layout decomposition**: Split `renderer/layout.ts` (929 lines) into `layout.ts` (428 lines) + `layout-sections.ts` (520 lines) — 15 section renderers extracted

### Summary
865 tests, 42 tools, 78 slash commands. Near-complete Claude Code parity. Layout engine decomposed. All Biome/TypeScript clean.

## 2.6.0 (2026-04-16) — Quality & Gap Closure

### Added
- **TodoWriteTool**: New tool for writing/updating todo items with ID-based upsert (42 tools total)
- **8 new slash commands**: `/bug`, `/feedback`, `/upgrade`, `/token-count`, `/benchmark`, `/vim`, `/login`/`/logout`, `/review-pr`, `/pr-comments`, `/add-dir` (59 total)
- **33 new tests**: Extended command tests, EvaluatorLoop tests (817 total)

### Changed
- **Command decomposition**: Split monolithic `commands/index.ts` (1,299 lines) into 6 domain modules — `session.ts`, `git.ts`, `info.ts`, `settings.ts`, `ai.ts`, `skills.ts` + thin registry (83 lines)
- **Model-aware extended thinking**: Anthropic thinking budget scales by model (Opus: 32K tokens, others: 10K). Max output tokens also model-aware (Opus: 16,384, others: 8,192)
- **OpenAI reasoning effort**: Now model-aware — full models get `high`, mini models get `medium`. Added `o4` model detection
- **InitWizard hooks**: Proper `useCallback` wrapping for `runTest`, correct dependency arrays (fixed 3 React warnings)

### Fixed
- 6 Biome lint warnings resolved (unused variables, exhaustive dependencies, dead code)
- 2 TODO comments resolved (hooks.ts prompt hook documented, skill template placeholder)
- Removed unused `inThinkingBlock` state tracking in Anthropic provider
- Removed unused `cursor` destructure in renderer layout

### Summary
817 tests, 42 tools, 59 slash commands. Zero Biome warnings. Commands decomposed for maintainability. Extended thinking now model-aware.

## 2.5.0 (2026-04-15) — Infrastructure & Community

### Added
- **MCP Server Mode**: `oh mcp-server` exposes all 41 tools as an MCP server via stdio JSON-RPC. Any MCP client (Claude Code, Cline, Gemini CLI) can call openHarness tools.
- **Skills Registry**: `oh skill search <query>` and `oh skill install <name>` for community skills. JSON-based registry at data/registry.json with 4 initial skills.
- **Auto-commit per tool**: `gitCommitPerTool` config option — atomic git commits after each file-modifying tool execution (Aider-style).
- **SWE-bench benchmark harness**: `scripts/swe-bench.mjs` runs openHarness against SWE-bench Lite with `--sample N` and `--instance` options. Results to BENCHMARKS.md.
- **Skill feedback loop**: Skills track `timesUsed` and `lastUsed` in frontmatter. Auto-extracted skills unused for 60 days (<2 uses) are pruned during consolidation.
- **Post-compact recovery**: Compression message tells LLM to re-read working files.
- **Compression circuit breaker**: Stops auto-compressing after 3 consecutive failures.
- **Compression telemetry**: Logs tokens before/after and strategy used.
- `/skill-search` and `/skill-install` slash commands.

### Changed
- README badges updated to match actual counts (784 tests, 41 tools)
- Comparison table tool count corrected

## 2.4.0 (2026-04-14) — Hermes Parity

### Added
- **Budget warnings**: 70%/90% cost and turn limit warnings injected into system prompt dynamically
- **Live memory injection**: Memory section refreshed mid-session when memories change (memoryVersion counter)
- **Skill CRUD commands**: `/skill-create`, `/skill-edit`, `/skill-delete`
- **Fallback provider chains**: `createFallbackProvider()` with transparent failover on rate limits and 5xx
- **`fallbackProviders` config**: Chain order in `.oh/config.yaml`
- **Skill system Claude Code compatibility**: Recursive directory scan, `allowedTools` parsing, `invokeModel: false`

### Changed
- USER_PROFILE_MAX_CHARS from 2000 to 1375 (Hermes-aligned)
- MEMORY_PROMPT_MAX_CHARS capped at 2200
- `memoriesToPrompt()` respects char cap
- `process.chdir()` race fixed — workingDir passed via QueryConfig
- FallbackProvider: activeFallback uses getter, stream fallback pre-stream only, 401/403 not retriable
- Removed 11 unnecessary `as any` casts

### Summary
777 tests. Hermes parity features + Claude Code skill compatibility. Budget warnings, live memory, skill CRUD, provider fallback, and recursive skill directory support.

## 2.3.1 (2026-04-14) — Polish

### Fixed
- Wire memories, skills, and user profile into system prompt (were built but never injected)
- Auto-trigger skill suggestions when user message matches skill triggers
- LLM quality gate before persisting extracted skills
- LLM-assisted user profile consolidation (replaces append+truncate)
- Fix `process.chdir()` race condition in AgentTool (pass workingDir via QueryConfig)
- 7 new tests (absolute path traversal, ScheduleWakeup lifecycle, FTS5 edge cases, agent eviction)

## 2.3.0 (2026-04-14) — Self-Evolving Agent

### Added
- **Self-Evolving Skills**: Agent automatically extracts reusable skill files from sessions with 5+ tool calls. Skills persist to `.oh/skills/auto/` with YAML frontmatter (`source: auto`, version tracking, session provenance). Powered by `SkillExtractor` service with LLM-based pattern analysis.
- **Session Search (SQLite FTS5)**: Cross-session full-text search via `SessionSearchTool`. Sessions indexed into `~/.oh/sessions.db` on every save. BM25-ranked results with snippet highlighting. `/rebuild-sessions` command for index maintenance.
- **Progressive Skill Disclosure**: Skills now use 3-level loading — Level 0 (name+description, ~30 tokens) in system prompt, Level 1 (full content) on `Skill(name)`, Level 2 (supporting files) on `Skill(name, path)`. 94% token reduction at 100+ skills.
- **User Modeling (USER.md)**: Auto-maintained user profile at `.oh/memory/USER.md` (2000 char max). Curates role, preferences, and workflows across sessions. Injected into system prompt as `# User Profile`.
- **`findSimilarSkill()`**: Fuzzy name/description matching for patch-vs-create decisions in skill extraction.
- **`/rebuild-sessions`**: Slash command to rebuild FTS5 search index from session JSON files.

### Changed
- `saveSession()` now indexes sessions into SQLite FTS5 (fire-and-forget, non-blocking)
- `sessionEnd` hook now receives session metadata (sessionId, model, provider)
- `SkillTool` accepts optional `path` parameter for Level 2 supporting file access
- New dependency: `better-sqlite3` for session search

### Summary
Hermes-inspired self-evolving agent features. The agent now learns from every session — extracting reusable skills, searching past sessions for context, and building a persistent user profile. 769 tests (was 749).

## 2.2.0 (2026-04-12) — Gap Closer

### Added
- **ScheduleWakeup Tool**: Self-paced autonomous agent loops with cache-aware timing (5-min TTL breakpoints). `suggestDelay()` utility for optimal delay calculation. `consumeWakeup()`/`cancelWakeup()` API for REPL integration.
- **`/loop` Command**: Run prompts repeatedly with fixed intervals (`/loop 5m /review`) or dynamic self-pacing via ScheduleWakeup.
- **Plan File Persistence**: `EnterPlanMode` creates unique plan files at `.oh/plans/<adjective-verb-noun>.md`. Plans persist across sessions.
- **ExitPlanMode `allowedPrompts`**: Pre-authorize specific actions (e.g., `{tool: "Bash", prompt: "run tests"}`) when exiting plan mode.
- **Agent Continuation Registry**: Background agents tracked in `AgentMessageBus`. `SendMessage` can target background agents by ID to query status and queue follow-up messages.
- **MEMORY.md Index**: Auto-generated index file with one-liner pointers to all memories. Refreshed on save and consolidation.
- **New Memory Types**: `user`, `feedback`, `reference` (Claude Code compatible) alongside legacy `convention`, `preference`, `debugging`.
- **Agent `isolation` Parameter**: Accept both `isolation: "worktree"` (Claude Code style) and `isolated: boolean` for API compatibility.
- **`/init` Command**: Initialize project with `.oh/RULES.md` and `.oh/config.yaml` templates.
- **`/permissions` Command**: View current permission mode or switch modes interactively.
- **`/allowed-tools` Command**: View configured tool permission rules from `.oh/config.yaml`.
- **Checkpoint Tests**: 9 tests covering snapshot, rewind, file extraction, and edge cases.

### Changed
- Default memory type changed from `convention` to `user`
- `/plan` command now instructs use of EnterPlanMode/ExitPlanMode tool workflow
- Memory detection prompt updated to use new type taxonomy
- `/help` categories updated with new commands

### Summary
Closes 10 of 14 identified gaps with Claude Code. 749 tests (was 716). New features: autonomous loops, persistent plans, agent continuation, memory indexing, and 3 new slash commands.

## 2.0.0 (2026-04-12) — Beyond Parity

### Added
- **Active Context Management**: Per-tool token budgets, sub-agent output folding, proactive compression. Prevents context overflow before it happens.
- **GAN-Style Evaluator Loop**: Generator→Evaluator adversarial refinement with weighted rubrics (correctness, completeness, quality, safety). `--evaluate` flag for headless mode.
- **Session Traces & Observability**: Structured spans for every turn, tool call, and compression. JSONL persistence, OpenTelemetry export format, `/trace` command.
- **Agent SDK (Library Mode)**: `createAgent()` programmatic API. `import { createAgent } from '@zhijiewang/openharness'` for CI/CD bots, PR review automation, GitHub Actions.
- **Meta-Harness Self-Optimization**: `oh optimize` command — agent modifies its own config, benchmarks after each change, keeps improvements. Based on AutoAgent research (#1 on SpreadsheetBench).

### Changed
- Package exports: `"."` now points to SDK (`dist/sdk/index.js`), CLI at `"./cli"`
- Sub-agent output automatically folded when >2KB (context folding)
- Tool output enforced against per-tool token budgets

## 1.4.0 (2026-04-11) — Full Claude Code Parity

### Added
- **12 Hook Events** (was 4): fileChanged, cwdChanged, subagentStart/Stop, preCompact/postCompact, configChange, notification
- **HTTP + Prompt Hook Types**: hooks can now POST to URLs or use LLM yes/no checks, not just shell commands
- **Path-Scoped Rules**: `.oh/rules/*.md` with `paths:` frontmatter for monorepo-aware instructions
- **@file References**: `@README.md` in prompts injects file content (up to 10KB)
- **Permission Specifiers**: `Bash(npm run *)`, `Edit(src/**/*.ts)` — glob-style argument matching in permission rules
- **Interactive Rewind**: `/rewind` shows numbered checkpoint list; `/rewind <n>` restores to specific point
- **PowerShell Tool**: Windows-native PowerShell execution (deferred, win32 only)
- **Monitor Tool**: Watch background processes with optional regex filtering and output streaming
- **--json-schema**: CLI flag for constrained structured output in headless mode
- **LSP Enhancements**: Added hover action and support for Go (gopls) and Rust (rust-analyzer) language servers

### Summary
This release closes all 10 identified gaps with Claude Code, achieving full feature parity as an open-source alternative. 39 tools, 10+ agent roles, 677 tests.

## 1.3.0 (2026-04-11)

### Added
- **Plugin Marketplace**: `marketplace.json` spec for curated plugin registries. Install from GitHub repos, npm packages, or URLs. Cached to `~/.oh/plugins/cache/`. Full `/plugins` command: search, install, uninstall, marketplace add/remove.
- **Markdown Agent Definitions**: Create agents as `.md` files in `.oh/agents/` or `~/.oh/agents/` — no TypeScript needed. YAML frontmatter for name, description, and tools.
- **Plugin Namespacing**: Skills from marketplace plugins auto-namespaced as `plugin-name:skill-name` to prevent conflicts.

## 1.2.0 (2026-04-11)

### Added
- **Tool Pipelines**: Declarative multi-step workflows via Pipeline tool. Steps execute in dependency order with $ref variable substitution. 11 tests.
- **Documentation Site**: GitHub Pages docs at docs/ — getting started, configuration reference, tools, agent roles, pipelines, MCP servers, remote API, architecture, plugins

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
