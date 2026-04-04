# llama.cpp / GGUF Support Design

## Problem
Users with .gguf model files cannot use them in openHarness without installing Ollama. The config.yaml format for local models is also unclear.

## Solution
Add a `llamacpp` provider that speaks to `llama-server` via OpenAI-compatible API. This is the industry-standard approach used by Claude Code, OpenCode, Aider, and Cline in 2026.

## Architecture
- New `LlamaCppProvider` class in `src/providers/llamacpp.ts`
- Registered in `src/providers/index.ts` alongside existing providers
- Default baseUrl: `http://localhost:8080` (llama-server default)
- Config: uses existing `provider`, `model`, `baseUrl` fields — no schema changes

## Provider API
| Method | Endpoint | Notes |
|---|---|---|
| stream() | POST /v1/chat/completions | SSE streaming |
| complete() | POST /v1/chat/completions | stream: false |
| fetchModels() | GET /v1/models | Lists loaded models |
| healthCheck() | GET /v1/models | Returns true if 200 |

## UX
- Init wizard: new "llama.cpp / GGUF" entry with collapsible setup instructions
- Setup panel shows: `llama-server --model ./your-model.gguf --port 8080 --alias my-model`
- Connection failure shows same instructions (not generic error)
- `oh models` command: queries fetchModels() and pretty-prints

## Config Example
```yaml
provider: llamacpp
# Model alias — must match --alias passed to llama-server
model: my-model
# URL where llama-server is running
baseUrl: http://localhost:8080
permissionMode: ask
```

## User Setup Flow
1. Download a GGUF model (e.g. from Hugging Face)
2. Run: `llama-server --model ./model.gguf --port 8080 --alias my-model`
3. Run: `oh init` → select "llama.cpp / GGUF" → test connection → pick model
4. Start: `oh` or `oh --model llamacpp/my-model`

## Verification
1. llama-server running → oh init detects it, lists models
2. oh models → shows available models
3. oh --model llamacpp/my-model → streaming chat works
4. llama-server stopped → oh init shows setup instructions
5. npm run build → no TypeScript errors
