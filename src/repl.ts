/**
 * Imperative REPL — extracted business logic from React REPL.tsx.
 * Uses TerminalRenderer for display instead of Ink.
 */

import type { Message } from './types/message.js';
import type { StreamEvent } from './types/events.js';
import type { Provider } from './providers/base.js';
import type { Tools } from './Tool.js';
import type { PermissionMode } from './types/permissions.js';
import { createAssistantMessage, createMessage, createInfoMessage } from './types/message.js';
import { query } from './query.js';
import { createSession, saveSession, loadSession, type Session } from './harness/session.js';
import { CostTracker, estimateCost, getContextWindow } from './harness/cost.js';
import { autoCommitAIEdits, isGitRepo } from './git/index.js';
import { cybergotchiEvents } from './cybergotchi/events.js';
import { loadCompanionConfig, saveCompanionConfig } from './cybergotchi/config.js';
import { readOhConfig, writeOhConfig } from './harness/config.js';
import { roll } from './cybergotchi/bones.js';
import { getSpecies } from './cybergotchi/species.js';
import { EYE_STYLES, RARITY_COLORS, RARITY_STARS } from './cybergotchi/types.js';
import { TerminalRenderer, type KeyEvent } from './renderer/index.js';
import { formatTokenCount } from './utils/format.js';
import { formatToolArgs, summarizeToolOutput } from './utils/tool-summary.js';
import { getCommandNames, getCommandEntries } from './commands/index.js';
import { handleUserInput } from './harness/submit-handler.js';
import { estimateMessageTokens, getContextWarning } from './harness/context-warning.js';
import { setActiveTheme } from './utils/theme-data.js';
import { resetStyleCache } from './renderer/layout.js';
import { resetMdStyleCache } from './renderer/markdown.js';
import { resetDiffStyleCache } from './renderer/diff.js';
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
  theme?: 'dark' | 'light';
  welcomeText?: string;
};

export async function startREPL(config: REPLConfig): Promise<void> {
  if (config.theme) setActiveTheme(config.theme);
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

  // Show banner on fresh sessions (set after renderer.start())
  const showBanner = messages.length === 0 && config.welcomeText;
  let loading = false;
  let currentModel = config.model ?? '';
  let abortController: AbortController | null = null;
  let inputText = '';
  let inputCursor = 0;
  let inputHistory: string[] = [];
  let historyIndex = -1;
  let vimMode: 'normal' | 'insert' | null = null;
  let acSuggestions: string[] = [];
  let acDescriptions: string[] = [];
  let acIndex = -1;

  function updateAutocomplete() {
    if (inputText.startsWith('/') && inputText.length > 1 && !inputText.includes(' ')) {
      const prefix = inputText.slice(1).toLowerCase();
      const entries = getCommandEntries().filter(e => e.name.startsWith(prefix)).slice(0, 5);
      acSuggestions = entries.map(e => e.name);
      acDescriptions = entries.map(e => e.description);
      acIndex = -1;
    } else {
      acSuggestions = [];
      acDescriptions = [];
      acIndex = -1;
    }
    renderer.setAutocomplete(acSuggestions, acIndex, acDescriptions);
  }

  // Companion
  let companionVisible = true;
  const companionConfig = loadCompanionConfig();
  if (companionConfig) {
    companionConfig.lifetime.totalSessions++;
    saveCompanionConfig(companionConfig);
    const bones = roll(companionConfig.seed);
    const species = getSpecies(bones.species);
    const eyes = EYE_STYLES[bones.eyeStyle % EYE_STYLES.length] ?? 'o o';
    const idleFrames = species.frames.idle;
    const color = RARITY_COLORS[bones.rarity];
    const nameLine = `${companionConfig.soul.name} ${RARITY_STARS[bones.rarity]}`;

    // Render initial frame
    const frame0 = (idleFrames[0] ?? []).map((l: string) => l.replace('{E}', eyes));
    renderer.setCompanion([...frame0, nameLine], color);

    // Animate on timer
    renderer.onAnimation((frameIdx) => {
      if (loading || !companionVisible) return;
      const f = idleFrames[frameIdx % idleFrames.length] ?? idleFrames[0] ?? [];
      const lines = f.map((l: string) => l.replace('{E}', eyes));
      renderer.setCompanion([...lines, nameLine], color);
    });
  }

  // Update renderer state
  function syncRenderer() {
    renderer.setMessages(messages);
    renderer.setLoading(loading);
    const hints = `exit to quit${loading ? ' | Ctrl+C to interrupt' : ''}${companionConfig?.soul?.name ? ` | @${companionConfig.soul.name} to chat` : ''}`;
    renderer.setStatusHints(hints);
    // Status line: model | tokens | cost
    const inTok = cost.totalInputTokens;
    const outTok = cost.totalOutputTokens;
    const totalCostVal = cost.totalCost;
    const parts: string[] = [];
    if (currentModel) parts.push(currentModel);
    if (inTok > 0 || outTok > 0) parts.push(`${formatTokenCount(inTok)}↑ ${formatTokenCount(outTok)}↓`);
    if (totalCostVal > 0) parts.push(`$${totalCostVal.toFixed(4)}`);
    // Context usage bar
    const ctxWindow = getContextWindow(currentModel);
    if (ctxWindow > 0 && estimatedTokenCount > 0) {
      const usage = Math.min(1, estimatedTokenCount / ctxWindow);
      const barWidth = 10;
      const filled = Math.max(1, Math.round(usage * barWidth));
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      const pct = Math.max(1, Math.ceil(usage * 100));
      parts.push(`ctx [${bar}] ${pct}%`);
    }
    renderer.setStatusLine(parts.join(' │ '));
    // Context warning
    updateContextWarning();
  }

  // formatTokenCount imported from utils/format.ts

  let estimatedTokenCount = 0;
  let lastMessageCount = 0;

  function updateContextWarning() {
    // Incremental: only estimate tokens for new messages since last check
    estimatedTokenCount += estimateMessageTokens(messages, lastMessageCount);
    lastMessageCount = messages.length;
    renderer.setContextWarning(getContextWarning(estimatedTokenCount, currentModel));
  }

  // Input handling
  renderer.onKeypress((key: KeyEvent) => {
    // Ctrl+C: abort or exit
    if (key.ctrl && key.char === 'c') {
      if (loading && abortController) {
        abortController.abort();
      } else {
        cleanup();
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

    // Session browser navigation
    if (renderer.isSessionBrowserOpen()) {
      if (key.name === 'up') { renderer.sessionBrowserUp(); return; }
      if (key.name === 'down') { renderer.sessionBrowserDown(); return; }
      if (key.name === 'return') {
        const id = renderer.sessionBrowserSelect();
        if (id) handleSubmit(`/resume ${id}`);
        return;
      }
      if (key.name === 'escape') { renderer.closeSessionBrowser(); return; }
      if (key.name === 'backspace') { renderer.sessionBrowserBackspace(); return; }
      if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
        renderer.sessionBrowserType(key.char);
        return;
      }
      return; // swallow other keys during browser
    }

    // Ctrl+K: toggle code block expansion
    if (key.ctrl && key.char === 'k' && !loading) {
      renderer.toggleCodeBlockExpansion();
      return;
    }

    // Ctrl+O: toggle thinking expansion
    if (key.ctrl && key.char === 'o') {
      renderer.toggleThinkingExpanded();
      return;
    }

    // Page Up/Down and Shift+Up/Down: scrollback navigation
    if (key.name === 'pageup') { renderer.scrollUp(10); return; }
    if (key.name === 'pagedown') { renderer.scrollDown(10); return; }
    if (key.shift && key.name === 'up') { renderer.scrollUp(3); return; }
    if (key.shift && key.name === 'down') { renderer.scrollDown(3); return; }

    // Tab: autocomplete slash commands, or cycle tool call expansion
    if (key.name === 'tab' && !loading) {
      if (acSuggestions.length > 0) {
        acIndex = (acIndex + 1) % acSuggestions.length;
        inputText = `/${acSuggestions[acIndex]!}`;
        inputCursor = inputText.length;
        renderer.setInputText(inputText);
        renderer.setInputCursor(inputCursor);
        renderer.setAutocomplete(acSuggestions, acIndex, acDescriptions);
        return;
      }
      renderer.cycleToolCallExpansion();
      return;
    }

    // Enter: submit
    if (key.name === 'return') {
      if (inputText.trim() && !loading) {
        handleSubmit(inputText.trim());
        inputHistory.unshift(inputText);
        historyIndex = -1;
        inputText = '';
        inputCursor = 0;
        acSuggestions = [];
        acIndex = -1;
        renderer.setAutocomplete([], -1);
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
    updateAutocomplete();
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
    // Clear welcome banner and any previous errors on new input
    renderer.setBanner(null);
    renderer.setError(null);

    // Exit
    if (input === 'exit' || input === 'quit' || input === '/exit' || input === '/quit' || input === '/q') {
      cleanup();
      process.exit(0);
    }

    const result = await handleUserInput(input, {
      messages,
      currentModel,
      providerName: config.provider.name,
      permissionMode: config.permissionMode,
      cost,
      sessionId: session.id,
      companionConfig,
    });

    messages = result.messages;
    // Check for special commands
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.content === '__OPEN_SESSION_BROWSER__') {
      messages = messages.slice(0, -1);
      renderer.openSessionBrowser();
      syncRenderer();
      return;
    }
    if (lastMsg?.content?.startsWith('__SWITCH_THEME__:')) {
      const themeName = lastMsg.content.split(':')[1] as 'dark' | 'light';
      messages = messages.slice(0, -1);
      setActiveTheme(themeName);
      resetStyleCache();
      resetMdStyleCache();
      resetDiffStyleCache();
      // Persist theme to config
      try {
        const cfg = readOhConfig() ?? { provider: config.provider.name, model: currentModel, permissionMode: config.permissionMode };
        cfg.theme = themeName;
        writeOhConfig(cfg);
      } catch { /* ignore */ }
      messages = [...messages, createInfoMessage(`Theme switched to ${themeName}`)];
      syncRenderer();
      return;
    }
    if (lastMsg?.content === '__COMPANION_OFF__' || lastMsg?.content === '__COMPANION_ON__') {
      companionVisible = lastMsg.content === '__COMPANION_ON__';
      messages = messages.slice(0, -1);
      if (!companionVisible) renderer.setCompanion(null, 'cyan');
      messages = [...messages, createInfoMessage(`Companion ${companionVisible ? 'shown' : 'hidden'}`)];
      syncRenderer();
      return;
    }
    if (result.newModel) currentModel = result.newModel;
    if (result.vimToggled) {
      vimMode = vimMode === null ? 'normal' : null;
      messages = [...messages, createInfoMessage(vimMode ? 'Vim mode ON' : 'Vim mode OFF')];
      renderer.setVimMode(vimMode);
    }
    syncRenderer();
    if (result.handled) return;
    if (result.prompt) await runQuery(result.prompt);
  }

  async function runQuery(prompt: string) {
    loading = true;
    renderer.setLoading(true);
    renderer.setThinkingStartedAt(Date.now());
    renderer.setError(null);
    renderer.clearToolCalls();

    abortController = new AbortController();
    let accumulated = '';
    const callIdToToolName = new Map<string, string>();

    const askUser = (toolName: string, description: string, riskLevel?: string): Promise<boolean> => {
      return renderer.askPermission(toolName, description, riskLevel ?? 'medium');
    };

    const askUserQuestion = (question: string, options?: string[]): Promise<string> => {
      return renderer.askQuestion(question, options);
    };

    const queryConfig = {
      provider: config.provider,
      tools: config.tools,
      systemPrompt: config.systemPrompt,
      permissionMode: config.permissionMode,
      askUser,
      askUserQuestion,
      model: currentModel || undefined,
      abortSignal: abortController.signal,
    };

    try {
      for await (const event of query(prompt, queryConfig, messages)) {
        switch (event.type) {
          case 'text_delta':
            renderer.scrollToBottom(); // auto-scroll on new content
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
            callIdToToolName.set(event.callId, event.toolName);
            renderer.setToolCall(event.callId, { toolName: event.toolName, status: 'running', startedAt: Date.now() });
            break;

          case 'tool_call_complete': {
            const tcToolName = callIdToToolName.get(event.callId) ?? '';
            const existingTc = renderer.getToolCall(event.callId);
            renderer.setToolCall(event.callId, {
              ...existingTc,
              toolName: tcToolName,
              status: 'running',
              args: formatToolArgs(tcToolName, event.arguments),
            });
            break;
          }

          case 'tool_output_delta': {
            // Accumulate streaming output lines
            const existing = renderer.getToolCall(event.callId) ?? {
              toolName: callIdToToolName.get(event.callId) ?? 'unknown',
              status: 'running' as const,
            };
            const lines = existing.liveOutput ?? [];
            const chunks = event.chunk.split('\n');
            const merged = [...lines];
            if (merged.length > 0 && !event.chunk.startsWith('\n')) {
              merged[merged.length - 1] = (merged[merged.length - 1] ?? '') + chunks[0];
              merged.push(...chunks.slice(1).filter((c: string) => c !== ''));
            } else {
              merged.push(...chunks.filter((c: string) => c !== ''));
            }
            renderer.setToolCall(event.callId, { ...existing, liveOutput: merged });
            break;
          }

          case 'tool_call_end': {
            const toolName = callIdToToolName.get(event.callId) ?? event.callId;
            const prevTc = renderer.getToolCall(event.callId);
            const elapsed = prevTc?.startedAt ? Math.floor((Date.now() - prevTc.startedAt) / 1000) : 0;
            renderer.setToolCall(event.callId, {
              toolName,
              status: event.isError ? 'error' : 'done',
              output: event.output?.slice(0, 500),
              args: prevTc?.args,
              resultSummary: event.output ? summarizeToolOutput(event.output) : undefined,
              startedAt: prevTc?.startedAt,
            });
            cybergotchiEvents.emit('cybergotchi', { type: event.isError ? 'toolError' : 'toolSuccess', toolName });
            // Auto-commit with file list
            if (!event.isError && isGitRepo()) {
              const rawArgs = prevTc?.args ?? '';
              const filePath = rawArgs.startsWith('$') ? null : rawArgs;
              const hash = autoCommitAIEdits(toolName, filePath ? [filePath] : [], process.cwd());
              if (hash) {
                // Show changed files in commit message
                let commitMsg = `git: committed ${hash}`;
                try {
                  const { execSync } = await import('node:child_process');
                  const files = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                  if (files) commitMsg += `\n${files.split('\n').map(f => `  ${f}`).join('\n')}`;
                } catch { /* ignore */ }
                messages = [...messages, createInfoMessage(commitMsg)];
                cybergotchiEvents.emit('cybergotchi', { type: 'commit' });
              }
            }
            break;
          }

          case 'cost_update':
            currentModel = event.model;
            cost.record('provider', event.model, event.inputTokens, event.outputTokens,
              event.cost || estimateCost(event.model, event.inputTokens, event.outputTokens));
            renderer.setTokenCount(cost.totalOutputTokens);
            syncRenderer();
            break;

          case 'rate_limited':
            renderer.setError(`⏳ Rate limited — retrying in ${event.retryIn}s (attempt ${event.attempt}/3)`);
            break;

          case 'error':
            renderer.setError(event.message);
            break;

          case 'turn_complete': {
            // Save thinking summary before clearing
            const thinkElapsed = renderer.getThinkingStartedAt()
              ? Math.floor((Date.now() - renderer.getThinkingStartedAt()!) / 1000)
              : 0;
            if (thinkElapsed > 0) {
              renderer.setLastThinkingSummary(`∴ Thought for ${thinkElapsed}s [Ctrl+O]`);
            } else {
              renderer.setLastThinkingSummary(null);
            }
            renderer.setThinkingText('');
            renderer.setThinkingStartedAt(null);
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
      renderer.scrollToBottom(); // Reset scroll so user sees latest content
      syncRenderer();
    }
  }

  // Centralized cleanup — ensures terminal is always restored
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    renderer.stop();
    session.messages = messages;
    session.totalCost = cost.totalCost;
    try { saveSession(session); } catch { /* ignore */ }
  }

  // Ensure terminal restoration on unexpected exit
  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => { cleanup(); console.error('Fatal:', err); process.exit(1); });

  // Start
  renderer.start();
  if (showBanner) renderer.setBanner(config.welcomeText!.split('\n'));
  syncRenderer();
}
