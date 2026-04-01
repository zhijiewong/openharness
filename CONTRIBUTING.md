# Contributing to OpenHarness

Thanks for your interest in contributing.

## Getting Started

```bash
git clone https://github.com/zhijiewong/openharness.git
cd openharness
npm install
```

## Development

```bash
npx tsx src/main.tsx              # run in dev mode
npx tsc --noEmit                  # type check
npm test                          # run tests
npm install -g .                  # install globally to test `oh` command
```

## Making Changes

1. Open an issue or discussion before starting large changes.
2. Create a branch from `main`.
3. Run `npx tsc --noEmit` and ensure zero errors before submitting a PR.
4. Keep the README and CLI help text in sync with code changes.

## Adding a New Provider

1. Create `src/providers/yourprovider.ts` implementing the `Provider` interface from `src/providers/base.ts`.
2. Implement `stream()`, `complete()`, `listModels()`, and `healthCheck()`.
3. Add a case in `src/providers/index.ts:createProviderInstance()`.
4. Add model pricing to `src/harness/cost.ts:MODEL_PRICING`.

## Adding a New Tool

1. Create `src/tools/YourTool/index.ts` implementing the `Tool` interface from `src/Tool.ts`.
2. Define a Zod input schema, set `name`, `description`, `riskLevel`.
3. Implement `call()`, `isReadOnly()`, `isConcurrencySafe()`, `prompt()`.
4. Register it in `src/tools.ts:getAllTools()`.

## Code Style

- TypeScript strict mode.
- Use Zod for all input validation.
- Async generators for streaming.
- No CLA required.

## Reporting Issues

Open an issue on GitHub with:
- What you expected vs what happened
- Steps to reproduce
- Node.js version and OS
