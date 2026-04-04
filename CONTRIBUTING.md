# Contributing to OpenHarness

Thanks for wanting to contribute! OpenHarness is built by the community. Here's how to get involved.

## Dev Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/zhijiewong/openharness.git
   cd openharness
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run locally:**
   ```bash
   npm run dev
   ```

## Running Tests

```bash
npm test
```

Uses Node's built-in test runner via `scripts/test.mjs`.

## Building

```bash
npm run build
```

Compiles TypeScript in `src/` to `dist/`.

## Project Structure

- **`src/providers/`** — LLM provider adapters (Ollama, OpenAI, Anthropic, OpenRouter, llama.cpp)
- **`src/components/`** — React/Ink terminal UI components (REPL, panels, banners)
- **`src/harness/`** — Core agent loop, tool execution, session management
- **`src/tools/`** — Built-in tools (Read, Write, Edit, Bash, Glob, etc.)

## Adding a Provider

1. Create `src/providers/yourprovider.ts` implementing the `Provider` interface
2. Register it in `src/providers/index.ts` in the `createProviderInstance()` switch statement
3. Reference `src/providers/ollama.ts` as the template — it shows message conversion, streaming, and tool call handling

Providers handle auth (API keys, base URLs), message formatting, and model info.

## Submitting a PR

1. Fork the repo
2. Create a branch from `main`
3. Make your changes and test them locally with `npm run dev` and `npm test`
4. Write a clear PR description — what problem does this solve?
5. Push and open a PR

CI runs on Ubuntu and Windows. All checks must pass.

## Code Style

- **TypeScript strict mode** — `"strict": true` in tsconfig.json
- Match existing patterns and conventions
- Keep the same code structure and naming style
- No new dependencies without discussion — ask first in the PR or an issue

That's it. Happy hacking!
