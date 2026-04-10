/**
 * OpenHarness VS Code Extension
 *
 * Embeds the OpenHarness CLI in a VS Code terminal panel with:
 * - Start Chat: opens interactive REPL in integrated terminal
 * - Run Prompt: executes a single prompt headlessly
 * - Review Selection: sends selected code for AI review
 */

import * as vscode from 'vscode';

let terminal: vscode.Terminal | null = null;

function getConfig() {
  const config = vscode.workspace.getConfiguration('openharness');
  return {
    model: config.get<string>('model', 'ollama/llama3'),
    permissionMode: config.get<string>('permissionMode', 'ask'),
  };
}

function getOrCreateTerminal(): vscode.Terminal {
  if (terminal && terminal.exitStatus === undefined) {
    terminal.show();
    return terminal;
  }
  terminal = vscode.window.createTerminal({
    name: 'OpenHarness',
    iconPath: new vscode.ThemeIcon('hubot'),
  });
  terminal.show();
  return terminal;
}

export function activate(context: vscode.ExtensionContext) {

  // Command: Start interactive chat
  context.subscriptions.push(
    vscode.commands.registerCommand('openharness.start', () => {
      const { model, permissionMode } = getConfig();
      const t = getOrCreateTerminal();
      t.sendText(`npx openharness --model ${model} --permission-mode ${permissionMode}`);
    })
  );

  // Command: Run a prompt (headless)
  context.subscriptions.push(
    vscode.commands.registerCommand('openharness.run', async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: 'Enter prompt for OpenHarness',
        placeHolder: 'e.g., fix the failing tests',
      });
      if (!prompt) return;

      const { model, permissionMode } = getConfig();
      const t = getOrCreateTerminal();
      const escaped = prompt.replace(/"/g, '\\"');
      t.sendText(`npx openharness -p "${escaped}" --model ${model} --permission-mode ${permissionMode}`);
    })
  );

  // Command: Review selected code
  context.subscriptions.push(
    vscode.commands.registerCommand('openharness.review', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('No text selected');
        return;
      }

      const fileName = editor.document.fileName;
      const lang = editor.document.languageId;
      const { model } = getConfig();

      const t = getOrCreateTerminal();
      // Write selection to a temp approach — use stdin pipe
      const escaped = selection.replace(/"/g, '\\"').replace(/\n/g, '\\n').slice(0, 5000);
      t.sendText(
        `echo "${escaped}" | npx openharness run "Review this ${lang} code from ${fileName} for bugs, security issues, and improvements:" --model ${model} --deny`
      );
    })
  );

  // Clean up terminal on dispose
  context.subscriptions.push({
    dispose: () => {
      if (terminal) terminal.dispose();
    },
  });
}

export function deactivate() {
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
}
