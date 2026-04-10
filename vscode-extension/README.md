# OpenHarness for VS Code

AI coding agent in your editor — works with any LLM.

## Features

- **Start Chat**: Opens an interactive OpenHarness session in the integrated terminal
- **Run Prompt**: Execute a single prompt headlessly and see the output
- **Review Selection**: Right-click selected code to get AI review

## Requirements

- [OpenHarness CLI](https://www.npmjs.com/package/@zhijiewang/openharness) installed globally or via npx
- A model configured (Ollama for free local, or OpenAI/Anthropic API key)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `openharness.model` | `ollama/llama3` | Default model |
| `openharness.permissionMode` | `ask` | Permission mode (ask, trust, deny, auto) |

## Usage

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "OpenHarness"
3. Choose: Start Chat, Run Prompt, or Review Selection

Or right-click selected code → "OpenHarness: Review Selection"

## Development

```bash
cd vscode-extension
npm install
npm run build
# Press F5 in VS Code to launch Extension Development Host
```
