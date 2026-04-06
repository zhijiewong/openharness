# Changelog

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
