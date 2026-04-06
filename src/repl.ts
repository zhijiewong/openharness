/**
 * Imperative REPL — extracted business logic from React REPL.tsx.
 * Uses TerminalRenderer for display instead of Ink.
 */

import type { Message } from './types/message.js';
import type { StreamEvent } from './types/events.js';
import type { Provider } from './providers/base.js';
import type { Tools } from './Tool.js';
import type { PermissionMode } from './types/permissions.js';
import { createAssistantMessage, createUserMessage, createMessage, createInfoMessage } from './types/message.js';
import { query } from './query.js';
import { createSession, saveSession, loadSession, type Session } from './harness/session.js';
import { CostTracker, estimateCost, getContextWindow } from './harness/cost.js';
import { processSlashCommand, type CommandContext } from './commands/index.js';
import { autoCommitAIEdits, isGitRepo } from './git/index.js';
import { cybergotchiEvents } from './cybergotchi/events.js';
import { loadCompanionConfig, saveCompanionConfig } from './cybergotchi/config.js';
import { roll } from './cybergotchi/bones.js';
import { getSpecies } from './cybergotchi/species.js';
import { EYE_STYLES, RARITY_COLORS, RARITY_STARS } from './cybergotchi/types.js';
import { resolveMcpMention } from './mcp/loader.js';
import { TerminalRenderer, type KeyEvent } from './renderer/index.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type REPLConfig = {
  provider: Provider;
  tools: Tools;
  permissionMode: PermissionMode;
  systemPrompt: string;
  model?: string;
  initialMessages?: Message[];
  resumeSessionId?: string;
};

export async function startREPL(config: REPLConfig): Promise<void> {
  const renderer = new TerminalRenderer();

  // Session
  let session: Session;
  try {
    session = config.resumeSessionId
      ? loadSession(config.resumeSessionId)
      : createSession(config.provider.name, config.model ?? '');
  } catch {
    session = createSession(config.provider.name, config.model ?? '');
  }

  const cost = new CostTracker();
  let messages: Message[] = config.resumeSessionId ? session.messages : (config.initialMessages ?? []);
  let loading = false;
  let currentModel = config.model ?? '';
  let abortController: AbortController | null = null;
  let inputText = '';
  let inputCursor = 0;
  let inputHistory: string[] = [];
  let historyIndex = -1;
  let vimMode: 'normal' | 'insert' | null = null;

  // Companion
  const companionConfig = loadCompanionConfig();
  if (companionConfig) {
    companionConfig.lifetime.totalSessions++;
    saveCompanionConfig(companionConfig);
    const bones = roll(companionConfig.seed);
    const species = getSpecies(bones.species);
    const eyes = EYE_STYLES[bones.eyeStyle % EYE_STYLES.length] ?? 'o o';
    const frames = species.frames.idle;
    const frame = frames[0] ?? [];
    const lines = frame.map((l: string) => l.replace('{E}', eyes));
    const color = RARITY_COLORS[bones.rarity];
    const name = `${companionConfig.soul.name} ${RARITY_STARS[bones.rarity]}`;
    renderer.setCompanion([...lines, name], color);
  }

  // Update renderer state
  function syncRenderer() {
    renderer.setMessages(messages);
    renderer.setLoading(loading);
    const hints = `exit to quit${loading ? ' | Ctrl+C to interrupt' : ''}${companionConfig?.soul?.name ? ` | @${companionConfig.soul.name} to chat` : ''}`;
    renderer.setStatusHints(hints);
  }

  // Input handling
  renderer.onKeypress((key: KeyEvent) => {
    // Ctrl+C: abort or exit
    if (key.ctrl && key.char === 'c') {
      if (loading && abortController) {
        abortController.abort();
      } else {
        renderer.stop();
        process.exit(0);
      }
      return;
    }

    // Vim mode toggle via escape
    if (vimMode !== null) {
      if (key.name === 'escape') { vimMode = 'normal'; renderer.setVimMode(vimMode); return; }
      if (vimMode === 'normal') {
        if (key.char === 'i' || key.char === 'a') { vimMode = 'insert'; renderer.setVimMode(vimMode); return; }
        if (key.char === 'k' || key.name === 'up') { navigateHistory(-1); return; }
        if (key.char === 'j' || key.name === 'down') { navigateHistory(1); return; }
        return; // swallow other keys in normal mode
      }
    }

    // Enter: submit
    if (key.name === 'return') {
      if (inputText.trim() && !loading) {
        handleSubmit(inputText.trim());
        inputHistory.unshift(inputText);
        historyIndex = -1;
        inputText = '';
        inputCursor = 0;
        renderer.setInputText(inputText);
        renderer.setInputCursor(inputCursor);
      }
      return;
    }

    // History
    if (key.name === 'up') { navigateHistory(-1); return; }
    if (key.name === 'down') { navigateHistory(1); return; }

    // Editing
    if (key.name === 'backspace') {
      if (inputCursor > 0) {
        inputText = inputText.slice(0, inputCursor - 1) + inputText.slice(inputCursor);
        inputCursor--;
      }
    } else if (key.name === 'delete') {
      inputText = inputText.slice(0, inputCursor) + inputText.slice(inputCursor + 1);
    } else if (key.name === 'left') {
      if (inputCursor > 0) inputCursor--;
    } else if (key.name === 'right') {
      if (inputCursor < inputText.length) inputCursor++;
    } else if (key.ctrl && key.char === 'a') {
      inputCursor = 0;
    } else if (key.ctrl && key.char === 'e') {
      inputCursor = inputText.length;
    } else if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
      inputText = inputText.slice(0, inputCursor) + key.char + inputText.slice(inputCursor);
      inputCursor++;
    }

    renderer.setInputText(inputText);
    renderer.setInputCursor(inputCursor);
  });

  function navigateHistory(dir: number) {
    if (dir < 0 && historyIndex < inputHistory.length - 1) {
      historyIndex++;
      inputText = inputHistory[historyIndex]!;
    } else if (dir > 0) {
      if (historyIndex <= 0) { historyIndex = -1; inputText = ''; }
      else { historyIndex--; inputText = inputHistory[historyIndex]!; }
    }
    inputCursor = inputText.length;
    renderer.setInputText(inputText);
    renderer.setInputCursor(inputCursor);
  }

  async function handleSubmit(input: string) {
    // Exit
    if (input === 'exit' || input === 'quit' || input === '/exit' || input === '/quit') {
      renderer.stop();
      session.messages = messages;
      session.totalCost = cost.totalCost;
      try { saveSession(session); } catch { /* ignore */ }
      process.exit(0);
    }

    // Vim toggle
    if (input === '/vim') {
      vimMode = vimMode === null ? 'normal' : null;
      messages = [...messages, createInfoMessage(vimMode ? 'Vim mode ON' : 'Vim mode OFF')];
      renderer.setVimMode(vimMode);
      syncRenderer();
      return;
    }

    // Companion address
    if (companionConfig) {
      const name = companionConfig.soul.name.toLowerCase();
      const lower = input.toLowerCase();
      if (lower.startsWith(`@${name}`) || lower.startsWith(`${name},`) || lower.startsWith(`${name} `)) {
        cybergotchiEvents.emit('cybergotchi', { type: 'userAddressed', text: input });
        return;
      }
    }

    // Slash commands
    if (input.startsWith('/')) {
      const ctx: CommandContext = {
        messages, model: currentModel, providerName: config.provider.name,
        permissionMode: config.permissionMode,
        totalCost: cost.totalCost, totalInputTokens: cost.totalInputTokens,
        totalOutputTokens: cost.totalOutputTokens, sessionId: session.id,
      };
      const result = processSlashCommand(input, ctx);
      if (result) {
        if (result.clearMessages) messages = [];
        if (result.compactedMessages) messages = result.compactedMessages;
        if (result.newModel) currentModel = result.newModel;
        if (result.output) messages = [...messages, createInfoMessage(result.output)];
        syncRenderer();
        if (result.handled && !result.prependToPrompt) return;
        if (result.prependToPrompt) {
          messages = [...messages, createUserMessage(input)];
          syncRenderer();
          await runQuery(result.prependToPrompt);
          return;
        }
      }
    }

    // Normal prompt
    messages = [...messages, createUserMessage(input)];
    syncRenderer();

    // Resolve @mentions
    let resolvedInput = input;
    const mentionPattern = /@(\w[\w.-]*)/g;
    const mentions = [...input.matchAll(mentionPattern)].map(m => m[1]!);
    for (const mention of mentions) {
      if (companionConfig && mention.toLowerCase() === companionConfig.soul.name.toLowerCase()) continue;
      try {
        const content = await resolveMcpMention(mention);
        if (content) resolvedInput += `\n\n[Resource @${mention}]:\n${content.slice(0, 5000)}`;
      } catch { /* ignore */ }
    }

    await runQuery(resolvedInput);
  }

  async function runQuery(prompt: string) {
    loading = true;
    renderer.setLoading(true);
    renderer.setError(null);
    renderer.clearToolCalls();

    abortController = new AbortController();
    let accumulated = '';

    const askUser = (toolName: string, description: string, riskLevel?: string): Promise<boolean> => {
      // For now, auto-approve in the renderer (permission prompt TODO)
      return Promise.resolve(true);
    };

    const queryConfig = {
      provider: config.provider,
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      permissionMode: config.permissionMode,
      askUser,
      model: currentModel || undefined,
      abortSignal: abortController.signal,
    };

    try {
      for await (const event of query(prompt, queryConfig, messages)) {
        switch (event.type) {
          case 'text_delta':
            accumulated += event.content;
            // Move completed lines to messages, keep partial in streaming
            const lines = accumulated.split('\n');
            if (lines.length > 1) {
              const completedText = lines.slice(0, -1).join('\n');
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, content: last.content + completedText + '\n' }];
              } else {
                messages = [...messages, createMessage('assistant', completedText + '\n', { meta: { isStreaming: true } })];
              }
              accumulated = lines[lines.length - 1]!;
            }
            renderer.setMessages(messages);
            renderer.setStreamingText(accumulated);
            break;

          case 'thinking_delta':
            renderer.setThinkingText(event.content);
            break;

          case 'tool_call_start':
            renderer.setToolCall(event.callId, { toolName: event.toolName, status: 'running' });
            cybergotchiEvents.emit('cybergotchi', { type: 'toolSuccess', toolName: event.toolName });
            break;

          case 'tool_call_end':
            renderer.setToolCall(event.callId, {
              toolName: event.callId,
              status: event.isError ? 'error' : 'done',
              output: event.output?.slice(0, 200),
            });
            if (event.isError) {
              cybergotchiEvents.emit('cybergotchi', { type: 'toolError' });
            }
            // Auto-commit
            if (!event.isError && isGitRepo()) {
              const hash = autoCommitAIEdits(event.callId, [], process.cwd());
              if (hash) {
                messages = [...messages, createInfoMessage(`git: committed ${hash}`)];
                cybergotchiEvents.emit('cybergotchi', { type: 'commit' });
              }
            }
            break;

          case 'cost_update':
            currentModel = event.model;
            cost.record('provider', event.model, event.inputTokens, event.outputTokens,
              event.cost || estimateCost(event.model, event.inputTokens, event.outputTokens));
            break;

          case 'error':
            renderer.setError(event.message);
            break;

          case 'turn_complete':
            renderer.setThinkingText('');
            // Finalize streaming message
            if (accumulated) {
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, content: last.content + accumulated, meta: {} }];
              } else {
                messages = [...messages, createAssistantMessage(accumulated)];
              }
              accumulated = '';
            } else {
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, meta: {} }];
              }
            }
            renderer.setStreamingText('');
            // Save session
            session.messages = messages;
            session.totalCost = cost.totalCost;
            try { saveSession(session); } catch { /* ignore */ }
            break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        renderer.setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      loading = false;
      abortController = null;
      renderer.setLoading(false);
      renderer.setStreamingText('');
      syncRenderer();
    }
  }

  // Start
  renderer.start();
  syncRenderer();
}
