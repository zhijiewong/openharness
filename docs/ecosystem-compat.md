# Claude Code Ecosystem Compatibility

This document tracks what Claude Code conventions OpenHarness supports, where they diverge, and what's deferred. If you've built a plugin or skill for Claude Code, this is the page that tells you whether it will work in OpenHarness today.

Scope of this document: the published Anthropic spec at <https://agentskills.io/specification> and the Claude Code CLI docs at <https://code.claude.com/docs/en/>. Commit refs point to the OH commit that introduced each capability.

## Quick status

| Area | Status | Notes |
|---|---|---|
| Skill frontmatter (Anthropic kebab-case) | ✅ | Aliases for `allowed-tools`, `disable-model-invocation`, `argument-hint`, `when-to-use` |
| Skill `license` + `paths` fields | ✅ parsed | `paths` glob-scoped auto-surfacing is stored but not yet enforced at prompt time |
| Directory-packaged skills (`skill-name/SKILL.md`) | ✅ | Companion `.md` files inside the directory do not register as separate skills |
| `.claude/skills/` + `.claude/agents/` discovery | ✅ | Read alongside `.oh/skills/` and `.oh/agents/` |
| `.claude-plugin/plugin.json` manifest | ✅ | Auto-discovered from `~/.oh/plugins/cache/` even without `installed.json` entry |
| `.claude-plugin/marketplace.json` | ✅ | `addMarketplace` probes both OH-native and CC paths; source-typed entries (`github`, `npm`, `url`) are converted to OH's internal format |
| Plugin-shipped `.mcp.json` | ✅ discovered | Runtime injection into the MCP client is deferred (Phase 6) |
| Plugin-shipped `hooks/hooks.json` | ✅ discovered | Runtime registration with the hooks subsystem is deferred (Phase 6) |
| Plugin-shipped `.lsp.json` | ✅ discovered | Runtime wiring deferred |
| Sub-agent markdown (`.claude/agents/*.md`) | ✅ | Fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `isolation`, `mcpServers` (inline JSON), `hooks` (inline JSON) |
| Skill `context: fork` + `agent` fields | ✅ parsed | Dispatcher wiring (actual sub-agent spawn from skill) deferred |
| Permission enforcement in `oh mcp-server` | ⚠️ intentional | `toolPermissions` is NOT enforced when exposing tools via stdio — use `oh remote` if callers are less trusted |
| License gate on `/skill-install` | ✅ | Non-permissive SPDX licenses require `--accept-license=<id>`; `installable: false` entries are link-only |

## Field-by-field alias table (skills)

OH parses both forms. Both are interchangeable.

| Anthropic spec | OH legacy | Notes |
|---|---|---|
| `name` | `name` | required |
| `description` | `description` | required |
| `allowed-tools: Read Glob` | `allowedTools: [Read, Glob]` | Both accepted, merged |
| `disable-model-invocation: true` | `invokeModel: false` | Equivalent |
| `argument-hint: [--prod]` | `args: [--prod]` | Equivalent |
| `when-to-use: …` | (none) | New field; appended to description for future trigger matching |
| `license: MIT` | (none) | Used by the install gate |
| `paths: [src/**/*.ts]` | (none) | Stored; not yet used for auto-surfacing filtering |
| `context: fork` | (none) | Stored; dispatcher wiring deferred |
| `agent: code-reviewer` | (none) | Stored; dispatcher wiring deferred |

## Field-by-field alias table (agents)

| Anthropic spec | OH | Notes |
|---|---|---|
| `tools: Read Glob Grep` | `tools: [Read, Glob, Grep]` | Both accepted (space OR comma separated OR YAML array) |
| `disallowedTools: Write` | — | New field |
| `disallowed-tools: Write` | — | kebab alias also accepted |
| `model: sonnet` | — | New field |
| `isolation: worktree` | — | Explicit opt-in. Legacy OH auto-creates a worktree when in a git repo; explicit `isolation: worktree` is preferred |
| `mcpServers: {...}` | — | Inline JSON in YAML frontmatter |
| `hooks: {...}` | — | Inline JSON in YAML frontmatter |

## Marketplace source types

| Anthropic `source` form | Supported? | How OH resolves it |
|---|---|---|
| `./relative/path` | ❌ | Relative paths assume the marketplace repo is cloned locally; OH doesn't maintain that state |
| `{source: "github", repo, ref}` | ✅ | Converted to OH `{type: "github", repo}`; `ref` currently dropped |
| `{source: "url", url}` | ✅ | Converted to OH `{type: "url", url}` |
| `{source: "npm", package, version}` | ✅ | Converted to OH `{type: "npm", package}`; `version` dropped |

## Directory layout OH accepts for a plugin

```
<plugin-root>/
├── .claude-plugin/
│   └── plugin.json             ← manifest (required)
├── skills/
│   ├── flat-skill.md           ← OH-legacy flat layout
│   └── directory-skill/
│       ├── SKILL.md            ← Anthropic-style directory package
│       ├── reference.md        ← companion docs (read on demand, not a separate skill)
│       └── scripts/…           ← executable assets (not parsed)
├── agents/
│   ├── my-agent.md             ← subagent (Markdown + YAML frontmatter)
│   └── ...
├── .mcp.json                   ← MCP servers (discovered via getPluginMcpServers)
├── hooks/
│   └── hooks.json              ← hooks config (discovered via getPluginHooks)
└── .lsp.json                   ← LSP servers (discovered via getPluginLspServers)
```

Drop this layout anywhere under `~/.oh/plugins/cache/<name>/<version>/` and OH will surface it automatically — no entry in `installed.json` required. This means a Claude Code plugin `git clone`'d into the cache dir works without a registration step.

## What does NOT work (known gaps)

These items are parsed/discovered but not wired to OH's runtime yet. Track them in future sessions or PRs:

1. **AgentDispatcher per-agent MCP/hook injection.** Agent-level `mcpServers` and `hooks` fields are parsed and exposed on the `AgentRole` type, but `AgentDispatcher` doesn't filter the MCP server list or hook registrations per agent at dispatch time. Calling a sub-agent gets the full top-level config today.
2. **Skill `context: fork` execution.** The field is parsed, but the Skill tool doesn't currently spawn a sub-agent context when it encounters `context: fork` in a skill's frontmatter. The skill body executes in the parent agent's context.
3. **LSP plugin runtime wiring.** `.lsp.json` is discovered but not merged into OH's LSP client configuration.
4. **`paths:` glob auto-surfacing filter.** The field is stored on `SkillMetadata`; `findTriggeredSkills` doesn't yet consult it to scope which skill appears based on the file currently in scope.
5. **Anthropic proprietary skills.** `anthropics/skills` is proprietary (see its LICENSE.txt) and cannot be redistributed. OH's registry does not list it. If you want those skills, install them through Anthropic's own distribution channel.

## License policy for installing

OH's `/skill-install` gate uses this SPDX allowlist:

```
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, Unlicense
```

Anything outside the list requires `--accept-license=<SPDX>` to acknowledge the terms. `installable: false` registry entries are link-only (the user must install from upstream under the license's terms) — used today for CC-BY-SA (viral) content.

## Commit trail

| Session | Commit | Scope |
|---|---|---|
| 1 | `67cc1aa` | Skill format aliases, license gate, bundled-skill loading, /skills command, 3 OH-native skills, registry expanded 4→23 |
| 2 | `d47ddea` | Directory-packaged skills, .claude-plugin/plugin.json manifest discovery, /plugin alias + info subcommand |
| 3 | `d7447da` | AgentRole model/disallowedTools/isolation, .claude/agents/ discovery, .claude-plugin/marketplace.json parser, getPluginMcpServers/getPluginHooks |
| 4 | (this) | Skill context/agent fields, getPluginLspServers, AgentRole mcpServers/hooks parsing, CC-plugin integration test, this doc |

## Related docs

- [plugins.md](./plugins.md) — writing an OH-native plugin
- [mcp-servers.md](./mcp-servers.md) — configuring MCP servers in OH
- [agent-roles.md](./agent-roles.md) — building sub-agents
