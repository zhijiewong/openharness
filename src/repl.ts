/**
 * Imperative REPL — extracted business logic from React REPL.tsx.
 * Uses TerminalRenderer for display instead of Ink.
 */

import { homedir } from "node:os";
import { getCommandEntries } from "./commands/index.js";
import { roll } from "./cybergotchi/bones.js";
import { loadCompanionConfig, saveCompanionConfig } from "./cybergotchi/config.js";
import { cybergotchiEvents } from "./cybergotchi/events.js";
import { getSpecies } from "./cybergotchi/species.js";
import { EYE_STYLES, RARITY_COLORS, RARITY_STARS } from "./cybergotchi/types.js";
import { autoCommitAIEdits, isGitRepo } from "./git/index.js";
import { readOhConfig, writeOhConfig } from "./harness/config.js";
import { estimateMessageTokens, getContextWarning } from "./harness/context-warning.js";
import { CostTracker, estimateCost, getContextWindow } from "./harness/cost.js";
import { createSession, loadSession, type Session, saveSession } from "./harness/session.js";
import { createStore } from "./harness/store.js";
import { handleUserInput } from "./harness/submit-handler.js";
import type { Provider } from "./providers/base.js";
import { query } from "./query/index.js";
import { resetDiffStyleCache } from "./renderer/diff.js";
import { type KeyEvent, TerminalRenderer } from "./renderer/index.js";
import { resetStyleCache } from "./renderer/layout.js";
import { resetMdStyleCache } from "./renderer/markdown.js";
import type { Tools } from "./Tool.js";
import type { Message } from "./types/message.js";
import { createAssistantMessage, createInfoMessage, createMessage } from "./types/message.js";
import type { PermissionMode } from "./types/permissions.js";
import { formatTokenCount } from "./utils/format.js";
import { setActiveTheme } from "./utils/theme-data.js";
import { formatToolArgs, summarizeToolOutput } from "./utils/tool-summary.js";

export type REPLConfig = {
  provider: Provider;
  tools: Tools;
  permissionMode: PermissionMode;
  systemPrompt: string;
  model?: string;
  initialMessages?: Message[];
  resumeSessionId?: string;
  theme?: "dark" | "light";
  welcomeText?: string;
};

export async function startREPL(config: REPLConfig): Promise<void> {
  if (config.theme) setActiveTheme(config.theme);
  const renderer = new TerminalRenderer();

  // Set banner in live area (avoids the empty gap between scrollback banner and bottom-anchored input)
  if (config.welcomeText) {
    renderer.setBannerLines(config.welcomeText.split("\n"));
  }

  // Session
  let session: Session;
  const sessionExtras = {
    workingDir: process.cwd(),
    gitBranch: isGitRepo() ? (await import("./git/index.js")).gitBranch() : undefined,
    tools: config.tools.map((t) => t.name),
  };
  try {
    session = config.resumeSessionId
      ? loadSession(config.resumeSessionId)
      : createSession(config.provider.name, config.model ?? "", sessionExtras);
  } catch {
    session = createSession(config.provider.name, config.model ?? "", sessionExtras);
  }

  // Wake context: inject session summary when resuming
  if (config.resumeSessionId && session.hibernate) {
    const { buildWakeContext } = await import("./harness/session.js");
    const wakeMsg = buildWakeContext(session);
    const { createInfoMessage } = await import("./types/message.js");
    session.messages.push(createInfoMessage(wakeMsg));
  }

  // Initialize checkpoints for file rewind
  const { initCheckpoints } = await import("./harness/checkpoints.js");
  initCheckpoints(session.id);

  // Start background cron executor
  const { CronExecutor } = await import("./services/CronExecutor.js");
  const cronExecutor = new CronExecutor(
    config.provider,
    config.tools,
    config.systemPrompt,
    config.permissionMode,
    config.model,
  );
  cronExecutor.start();

  // A2A: publish agent card for cross-process discovery
  const { createSessionCard, publishCard, unpublishCard } = await import("./services/a2a.js");
  const agentCard = createSessionCard(session.id, {
    provider: config.provider.name,
    model: config.model,
  });
  publishCard(agentCard);

  const cost = new CostTracker();
  let cachedConfig = readOhConfig();

  // Centralized state store — all REPL state lives here
  const store = createStore({
    messages: config.resumeSessionId ? session.messages : (config.initialMessages ?? []),
    loading: false,
    currentModel: config.model ?? "",
    inputText: "",
    inputCursor: 0,
    inputHistory: [],
    historyIndex: -1,
    vimMode: null,
    fastMode: false,
    acSuggestions: [],
    acDescriptions: [],
    acIndex: -1,
    acTokenStart: 0,
    acIsPath: false,
    session,
  });

  // Convenience accessors (avoids store.getState().x everywhere)
  const s = () => store.getState();
  let abortController: AbortController | null = null;

  // Legacy aliases — these read/write through the store.
  // Gradually migrate callers to use store.setState() directly.
  let messages = s().messages;
  let loading = s().loading;
  let currentModel = s().currentModel;
  let inputText = s().inputText;
  let inputCursor = s().inputCursor;
  let inputHistory = s().inputHistory;
  let historyIndex = s().historyIndex;
  let vimMode = s().vimMode;
  let fastMode = s().fastMode;
  let acSuggestions = s().acSuggestions;
  let acDescriptions = s().acDescriptions;
  let acIndex = s().acIndex;
  let acTokenStart = s().acTokenStart;
  let acIsPath = s().acIsPath;

  // Sync store → legacy aliases when store changes (for code that reads locals)
  store.subscribe((state) => {
    messages = state.messages;
    loading = state.loading;
    currentModel = state.currentModel;
    inputText = state.inputText;
    inputCursor = state.inputCursor;
    inputHistory = state.inputHistory;
    historyIndex = state.historyIndex;
    vimMode = state.vimMode;
    fastMode = state.fastMode;
    acSuggestions = state.acSuggestions;
    acDescriptions = state.acDescriptions;
    acIndex = state.acIndex;
    acTokenStart = state.acTokenStart;
    acIsPath = state.acIsPath;
  });

  function updateAutocomplete() {
    acIsPath = false;
    if (inputText.startsWith("/") && inputText.length > 1 && !inputText.includes(" ")) {
      // Slash command autocomplete
      const prefix = inputText.slice(1).toLowerCase();
      const entries = getCommandEntries()
        .filter((e) => e.name.startsWith(prefix))
        .slice(0, 5);
      acSuggestions = entries.map((e) => e.name);
      acDescriptions = entries.map((e) => e.description);
      acTokenStart = 0;
      acIndex = -1;
    } else if (inputText.length > 0 && !inputText.startsWith("/")) {
      // File path autocomplete: extract token under cursor
      const beforeCursor = inputText.slice(0, inputCursor);
      const tokenMatch = beforeCursor.match(/(\S+)$/);
      if (
        tokenMatch &&
        (tokenMatch[1]!.includes("/") ||
          tokenMatch[1]!.includes("\\") ||
          tokenMatch[1]!.startsWith(".") ||
          tokenMatch[1]!.startsWith("~"))
      ) {
        const token = tokenMatch[1]!;
        acTokenStart = inputCursor - token.length;
        const expanded = token.startsWith("~") ? token.replace("~", homedir()) : token;
        const lastSep = Math.max(expanded.lastIndexOf("/"), expanded.lastIndexOf("\\"));
        const dir = lastSep >= 0 ? expanded.slice(0, lastSep + 1) : ".";
        const prefix = lastSep >= 0 ? expanded.slice(lastSep + 1) : expanded;
        try {
          const { readdirSync, statSync } = require("node:fs");
          const entries = (readdirSync(dir) as string[])
            .filter((name: string) => name.toLowerCase().startsWith(prefix.toLowerCase()))
            .slice(0, 10);
          acSuggestions = entries.map((name: string) => {
            const full = dir === "." ? name : dir + name;
            try {
              return statSync(full).isDirectory() ? `${full}/` : full;
            } catch {
              return full;
            }
          });
          acDescriptions = entries.map((name: string) => {
            const full = dir === "." ? name : dir + name;
            try {
              return statSync(full).isDirectory() ? "[dir]" : "[file]";
            } catch {
              return "";
            }
          });
          acIsPath = acSuggestions.length > 0;
        } catch {
          acSuggestions = [];
          acDescriptions = [];
        }
        acIndex = -1;
      } else {
        acSuggestions = [];
        acDescriptions = [];
        acIndex = -1;
      }
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
    const eyes = EYE_STYLES[bones.eyeStyle % EYE_STYLES.length] ?? "o o";
    const idleFrames = species.frames.idle;
    const color = RARITY_COLORS[bones.rarity];
    const nameLine = `${companionConfig.soul.name} ${RARITY_STARS[bones.rarity]}`;

    // Render initial frame
    const frame0 = (idleFrames[0] ?? []).map((l: string) => l.replace("{E}", eyes));
    renderer.setCompanion([...frame0, nameLine], color);

    // Animate on timer
    renderer.onAnimation((frameIdx) => {
      if (!companionVisible) return;
      const f = idleFrames[frameIdx % idleFrames.length] ?? idleFrames[0] ?? [];
      const lines = f.map((l: string) => l.replace("{E}", eyes));
      renderer.setCompanion([...lines, nameLine], color);
    });
  }

  // Update renderer state
  /** Sync local aliases back to the centralized store */
  function syncStore() {
    store.setState({
      messages,
      loading,
      currentModel,
      inputText,
      inputCursor,
      inputHistory,
      historyIndex,
      vimMode,
      fastMode,
      acSuggestions,
      acDescriptions,
      acIndex,
      acTokenStart,
      acIsPath,
    });
  }

  function syncRenderer() {
    syncStore();
    renderer.setMessages(messages);
    renderer.setLoading(loading);
    const hints = `exit to quit${loading ? " | Ctrl+C stop | Ctrl+O thinking" : " | Tab expand tools | Ctrl+O transcript"}${companionConfig?.soul?.name ? ` | @${companionConfig.soul.name}` : ""}`;
    renderer.setStatusHints(hints);
    // Status line: model | tokens | cost | ctx
    const inTok = cost.totalInputTokens;
    const outTok = cost.totalOutputTokens;
    const totalCostVal = cost.totalCost;
    const tokensStr = inTok > 0 || outTok > 0 ? `${formatTokenCount(inTok)}↑ ${formatTokenCount(outTok)}↓` : "";
    const costStr = totalCostVal > 0 ? `$${totalCostVal.toFixed(4)}` : "";
    let ctxStr = "";
    const ctxWindow = getContextWindow(currentModel);
    if (ctxWindow > 0 && estimatedTokenCount > 0) {
      const usage = Math.min(1, estimatedTokenCount / ctxWindow);
      const barWidth = 10;
      const filled = Math.max(1, Math.round(usage * barWidth));
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      const pct = Math.max(1, Math.ceil(usage * 100));
      ctxStr = `ctx [${bar}] ${pct}%`;
    }

    // Use template if configured, otherwise default format
    if (cachedConfig?.statusLineFormat) {
      const line = cachedConfig.statusLineFormat
        .replace("{model}", currentModel || "")
        .replace("{tokens}", tokensStr)
        .replace("{cost}", costStr)
        .replace("{ctx}", ctxStr)
        .replace(/\s*│\s*│/g, "│") // collapse empty sections
        .replace(/^│\s*/, "")
        .replace(/\s*│$/, ""); // trim leading/trailing separators
      renderer.setStatusLine(line);
    } else {
      const parts: string[] = [];
      if (currentModel) parts.push(currentModel);
      if (tokensStr) parts.push(tokensStr);
      if (costStr) parts.push(costStr);
      if (ctxStr) parts.push(ctxStr);
      renderer.setStatusLine(parts.join(" │ "));
    }
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
    if (key.ctrl && key.char === "c") {
      if (loading && abortController) {
        abortController.abort();
      } else {
        cleanup();
        process.exit(0);
      }
      return;
    }

    // Search: use terminal's native search (Ctrl+Shift+F in VS Code)

    // Vim mode
    if (vimMode !== null) {
      if (key.name === "escape") {
        vimMode = "normal";
        renderer.setVimMode(vimMode);
        return;
      }
      if (vimMode === "normal") {
        // -- Mode transitions --
        if (key.char === "i") {
          vimMode = "insert";
          renderer.setVimMode(vimMode);
          return;
        }
        if (key.char === "a") {
          vimMode = "insert";
          renderer.setVimMode(vimMode);
          if (inputCursor < inputText.length) inputCursor++;
          renderer.setInputCursor(inputCursor);
          return;
        }
        if (key.char === "I") {
          vimMode = "insert";
          renderer.setVimMode(vimMode);
          inputCursor = 0;
          renderer.setInputCursor(inputCursor);
          return;
        }
        if (key.char === "A") {
          vimMode = "insert";
          renderer.setVimMode(vimMode);
          inputCursor = inputText.length;
          renderer.setInputCursor(inputCursor);
          return;
        }
        if (key.char === "o") {
          vimMode = "insert";
          renderer.setVimMode(vimMode);
          inputText = `${inputText}\n`;
          inputCursor = inputText.length;
          renderer.setInputText(inputText);
          renderer.setInputCursor(inputCursor);
          return;
        }
        // -- Movement --
        if (key.char === "h" || key.name === "left") {
          if (inputCursor > 0) {
            inputCursor--;
            renderer.setInputCursor(inputCursor);
          }
          return;
        }
        if (key.char === "l" || key.name === "right") {
          if (inputCursor < inputText.length) {
            inputCursor++;
            renderer.setInputCursor(inputCursor);
          }
          return;
        }
        if (key.char === "j" || key.name === "down") {
          navigateHistory(1);
          return;
        }
        if (key.char === "k" || key.name === "up") {
          navigateHistory(-1);
          return;
        }
        if (key.char === "0") {
          inputCursor = 0;
          renderer.setInputCursor(inputCursor);
          return;
        }
        if (key.char === "$") {
          inputCursor = inputText.length;
          renderer.setInputCursor(inputCursor);
          return;
        }
        // Word forward (w)
        if (key.char === "w") {
          const rest = inputText.slice(inputCursor);
          const m = rest.match(/^\S*\s+/);
          inputCursor = m ? Math.min(inputCursor + m[0].length, inputText.length) : inputText.length;
          renderer.setInputCursor(inputCursor);
          return;
        }
        // Word backward (b)
        if (key.char === "b") {
          const before = inputText.slice(0, inputCursor);
          const m = before.match(/\S+\s*$/);
          inputCursor = m ? inputCursor - m[0].length : 0;
          renderer.setInputCursor(inputCursor);
          return;
        }
        // End of word (e)
        if (key.char === "e") {
          const rest = inputText.slice(inputCursor + 1);
          const m = rest.match(/^\s*\S*/);
          inputCursor = m ? Math.min(inputCursor + 1 + m[0].length, inputText.length) : inputText.length;
          renderer.setInputCursor(inputCursor);
          return;
        }
        // -- Editing --
        if (key.char === "x") {
          if (inputCursor < inputText.length) {
            inputText = inputText.slice(0, inputCursor) + inputText.slice(inputCursor + 1);
            if (inputCursor >= inputText.length && inputCursor > 0) inputCursor--;
            renderer.setInputText(inputText);
            renderer.setInputCursor(inputCursor);
          }
          return;
        }
        // dd — delete entire line
        if (key.char === "d") {
          // Simple: clear entire input (like dd in single-line mode)
          inputText = "";
          inputCursor = 0;
          renderer.setInputText(inputText);
          renderer.setInputCursor(inputCursor);
          return;
        }
        // Submit with Enter even in normal mode
        if (key.name === "return") {
          if (inputText.trim() && !loading) {
            handleSubmit(inputText.trim());
            inputHistory.unshift(inputText);
            historyIndex = -1;
            inputText = "";
            inputCursor = 0;
            acSuggestions = [];
            acDescriptions = [];
            renderer.setInputText(inputText);
            renderer.setInputCursor(inputCursor);
            renderer.setAutocomplete([], -1);
          }
          return;
        }
        return; // swallow other keys in normal mode
      }
    }

    // Session browser navigation
    if (renderer.isSessionBrowserOpen()) {
      if (key.name === "up") {
        renderer.sessionBrowserUp();
        return;
      }
      if (key.name === "down") {
        renderer.sessionBrowserDown();
        return;
      }
      if (key.name === "return") {
        const id = renderer.sessionBrowserSelect();
        if (id) handleSubmit(`/resume ${id}`);
        return;
      }
      if (key.name === "escape") {
        renderer.closeSessionBrowser();
        return;
      }
      if (key.name === "backspace") {
        renderer.sessionBrowserBackspace();
        return;
      }
      if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
        renderer.sessionBrowserType(key.char);
        return;
      }
      return; // swallow other keys during browser
    }

    // Ctrl+K: toggle code block expansion
    if (key.ctrl && key.char === "k" && !loading) {
      renderer.toggleCodeBlockExpansion();
      return;
    }

    // Ctrl+O: cycle through views — thinking toggle → transcript (flush all to scrollback)
    if (key.ctrl && key.char === "o") {
      if (loading) {
        // During streaming: toggle thinking expansion
        renderer.toggleThinkingExpanded();
      } else {
        // When idle: flush all messages to scrollback for review (transcript mode)
        // This makes the full conversation visible in native terminal scrollback
        renderer.clearLiveArea();
        renderer.setMessages(messages);
        renderer.flushMessages();
        renderer.notify("Transcript written to scrollback (scroll up to review)");
      }
      return;
    }

    // Scroll wheel: adjust manual scroll offset
    if (key.name === "scrollup") {
      renderer.scrollBy(3);
      return;
    }
    if (key.name === "scrolldown") {
      renderer.scrollBy(-3);
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown" || key.name === "mouse") return;

    // Tab: autocomplete slash commands or file paths, or cycle tool call expansion
    if (key.name === "tab" && !loading) {
      if (acSuggestions.length > 0) {
        acIndex = (acIndex + 1) % acSuggestions.length;
        if (acIsPath) {
          // Replace only the token under cursor
          const afterToken = inputText.slice(inputCursor);
          inputText = inputText.slice(0, acTokenStart) + acSuggestions[acIndex]! + afterToken;
          inputCursor = acTokenStart + acSuggestions[acIndex]!.length;
        } else {
          // Replace entire input for slash commands
          inputText = `/${acSuggestions[acIndex]!}`;
          inputCursor = inputText.length;
        }
        renderer.setInputText(inputText);
        renderer.setInputCursor(inputCursor);
        renderer.setAutocomplete(acSuggestions, acIndex, acDescriptions);
        return;
      }
      renderer.cycleToolCallExpansion();
      return;
    }

    // Alt+Enter or paste newline: insert newline at cursor
    if (key.name === "newline") {
      inputText = `${inputText.slice(0, inputCursor)}\n${inputText.slice(inputCursor)}`;
      inputCursor++;
      renderer.setInputText(inputText);
      renderer.setInputCursor(inputCursor);
      return;
    }

    // Enter: submit
    if (key.name === "return") {
      if (inputText.trim() && !loading) {
        handleSubmit(inputText.trim());
        inputHistory.unshift(inputText);
        historyIndex = -1;
        inputText = "";
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
    if (key.name === "up") {
      navigateHistory(-1);
      return;
    }
    if (key.name === "down") {
      navigateHistory(1);
      return;
    }

    // Editing
    if (key.name === "backspace") {
      if (inputCursor > 0) {
        inputText = inputText.slice(0, inputCursor - 1) + inputText.slice(inputCursor);
        inputCursor--;
      }
    } else if (key.name === "delete") {
      inputText = inputText.slice(0, inputCursor) + inputText.slice(inputCursor + 1);
    } else if (key.name === "left") {
      if (inputCursor > 0) inputCursor--;
    } else if (key.name === "right") {
      if (inputCursor < inputText.length) inputCursor++;
    } else if (key.ctrl && key.char === "a") {
      inputCursor = 0;
    } else if (key.ctrl && key.char === "e") {
      inputCursor = inputText.length;
    } else if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
      inputText = inputText.slice(0, inputCursor) + key.char + inputText.slice(inputCursor);
      inputCursor++;
    }

    renderer.setInputText(inputText);
    renderer.setInputCursor(inputCursor);
    updateAutocomplete();

    // Sync local aliases back to store after each keypress
    store.setState({
      messages,
      loading,
      currentModel,
      inputText,
      inputCursor,
      inputHistory,
      historyIndex,
      vimMode,
      fastMode,
      acSuggestions,
      acDescriptions,
      acIndex,
      acTokenStart,
      acIsPath,
    });
  });

  function navigateHistory(dir: number) {
    if (dir < 0 && historyIndex < inputHistory.length - 1) {
      historyIndex++;
      inputText = inputHistory[historyIndex]!;
    } else if (dir > 0) {
      if (historyIndex <= 0) {
        historyIndex = -1;
        inputText = "";
      } else {
        historyIndex--;
        inputText = inputHistory[historyIndex]!;
      }
    }
    inputCursor = inputText.length;
    renderer.setInputText(inputText);
    renderer.setInputCursor(inputCursor);
  }

  async function handleSubmit(input: string) {
    // Clear any previous errors on new input
    renderer.setError(null);

    // Exit
    if (input === "exit" || input === "quit" || input === "/exit" || input === "/quit" || input === "/q") {
      // Hibernate: save session state for potential wake-up resume
      try {
        const { buildHibernateState } = await import("./harness/session.js");
        session.hibernate = buildHibernateState(messages);
      } catch {
        /* ignore */
      }
      // Dream consolidation: prune stale memories before exit
      try {
        const { consolidateMemories } = await import("./harness/memory.js");
        const { readOhConfig } = await import("./harness/config.js");
        const ohCfg = readOhConfig();
        if (ohCfg?.memory?.consolidateOnExit !== false) {
          consolidateMemories();
        }
      } catch {
        /* ignore */
      }
      // Post-session learning: extract skills + update user profile
      try {
        const { runExtraction } = await import("./services/SkillExtractor.js");
        const { updateUserProfile, loadUserProfile, detectMemories } = await import("./harness/memory.js");

        // Skill extraction (async, may take a few seconds)
        const extracted = await runExtraction(config.provider, messages, session.id, currentModel);
        if (extracted.length > 0) {
          console.log(`[learn] Extracted ${extracted.length} skill(s) from this session.`);
        }

        // User profile update
        if (messages.length >= 6) {
          const detected = await detectMemories(config.provider, messages, currentModel);
          const profileUpdates = detected.filter((d) => d.type === "user");
          if (profileUpdates.length > 0) {
            const currentProfile = loadUserProfile();
            const newObservations = profileUpdates.map((d) => d.content).join("\n");
            const merged = currentProfile
              ? `${currentProfile}\n\n## Recent Observations\n${newObservations}`
              : newObservations;
            updateUserProfile(merged);
          }
        }
      } catch {
        /* learning is optional — don't block exit */
      }
      // Emit sessionEnd hook
      try {
        const { emitHookAsync } = await import("./harness/hooks.js");
        await emitHookAsync("sessionEnd", {
          sessionId: session.id,
          model: currentModel,
          provider: config.provider.name,
        });
      } catch {
        /* ignore */
      }
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
    if (lastMsg?.content === "__OPEN_SESSION_BROWSER__") {
      messages = messages.slice(0, -1);
      renderer.openSessionBrowser();
      syncRenderer();
      return;
    }
    if (lastMsg?.content?.startsWith("__SWITCH_THEME__:")) {
      const themeName = lastMsg.content.split(":")[1] as "dark" | "light";
      messages = messages.slice(0, -1);
      setActiveTheme(themeName);
      resetStyleCache();
      resetMdStyleCache();
      resetDiffStyleCache();
      // Persist theme to config
      try {
        const cfg = cachedConfig ?? {
          provider: config.provider.name,
          model: currentModel,
          permissionMode: config.permissionMode,
        };
        cfg.theme = themeName;
        writeOhConfig(cfg);
        cachedConfig = cfg;
      } catch {
        /* ignore */
      }
      messages = [...messages, createInfoMessage(`Theme switched to ${themeName}`)];
      syncRenderer();
      return;
    }
    if (lastMsg?.content === "__COMPANION_OFF__" || lastMsg?.content === "__COMPANION_ON__") {
      companionVisible = lastMsg.content === "__COMPANION_ON__";
      messages = messages.slice(0, -1);
      if (!companionVisible) renderer.setCompanion(null, "cyan");
      messages = [...messages, createInfoMessage(`Companion ${companionVisible ? "shown" : "hidden"}`)];
      syncRenderer();
      return;
    }
    if (result.newModel) currentModel = result.newModel;
    if (result.vimToggled) {
      vimMode = vimMode === null ? "normal" : null;
      messages = [...messages, createInfoMessage(vimMode ? "Vim mode ON" : "Vim mode OFF")];
      renderer.setVimMode(vimMode);
    }
    if (result.fastModeToggled) {
      fastMode = !fastMode;
      messages = [...messages, createInfoMessage(fastMode ? "Fast mode ON — optimized for speed" : "Fast mode OFF")];
    }
    // Clear old live area BEFORE syncRenderer when a query will follow.
    // syncRenderer → scheduleRender → queueMicrotask(render). The microtask fires
    // at the next await boundary. Without clearing first, the render's flushMessages()
    // writes on top of the old live area (banner/companion/input), causing double ❯
    // and ghost artifacts.
    if (result.prompt) renderer.clearLiveArea();
    syncRenderer();
    if (result.handled) return;
    if (result.prompt) await runQuery(result.prompt);
  }

  async function runQuery(prompt: string) {
    // Messages already set by handleSubmit's syncRenderer().
    // Live area already cleared and flushed by the render microtask
    // that fires between syncRenderer() and this await point.
    loading = true;
    renderer.setLoading(true);
    // Don't set thinkingStartedAt here — only on first thinking_delta event
    renderer.setError(null);
    renderer.clearToolCalls();

    abortController = new AbortController();
    let accumulated = "";
    const callIdToToolName = new Map<string, string>();

    const askUser = (toolName: string, description: string, riskLevel?: string): Promise<boolean> => {
      return renderer.askPermission(toolName, description, riskLevel ?? "medium");
    };

    const askUserQuestion = (question: string, options?: string[]): Promise<string> => {
      return renderer.askQuestion(question, options);
    };

    const effectiveSystemPrompt = fastMode
      ? config.systemPrompt +
        "\n\nIMPORTANT: Fast mode is active. Be extremely concise. Skip explanations. Go straight to the answer or action."
      : config.systemPrompt;

    const queryConfig = {
      provider: config.provider,
      tools: config.tools,
      systemPrompt: effectiveSystemPrompt,
      permissionMode: config.permissionMode,
      askUser,
      askUserQuestion,
      model: currentModel || undefined,
      abortSignal: abortController.signal,
    };

    try {
      for await (const event of query(prompt, queryConfig, messages)) {
        switch (event.type) {
          case "text_delta": {
            // Content auto-scrolls via terminal native scrollback
            accumulated += event.content;
            // Move completed lines to messages, keep partial in streaming
            const lines = accumulated.split("\n");
            if (lines.length > 1) {
              const completedText = lines.slice(0, -1).join("\n");
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, content: `${last.content + completedText}\n` }];
              } else {
                messages = [
                  ...messages,
                  createMessage("assistant", `${completedText}\n`, { meta: { isStreaming: true } }),
                ];
              }
              accumulated = lines[lines.length - 1]!;
            }
            renderer.setMessages(messages);
            renderer.setStreamingText(accumulated);
            break;
          }

          case "thinking_delta":
            if (!renderer.getThinkingStartedAt()) renderer.setThinkingStartedAt(Date.now());
            renderer.setThinkingText(event.content);
            break;

          case "tool_call_start": {
            callIdToToolName.set(event.callId, event.toolName);
            const isAgentTool = event.toolName === "Agent" || event.toolName === "ParallelAgents";
            renderer.setToolCall(event.callId, {
              toolName: event.toolName,
              status: "running",
              startedAt: Date.now(),
              isAgent: isAgentTool,
            });
            break;
          }

          case "tool_call_complete": {
            const tcToolName = callIdToToolName.get(event.callId) ?? "";
            const existingTc = renderer.getToolCall(event.callId);
            const isAgentCall = tcToolName === "Agent" || tcToolName === "ParallelAgents";
            const agentDesc = isAgentCall
              ? ((event.arguments as Record<string, unknown>).description as string | undefined)
              : undefined;
            renderer.setToolCall(event.callId, {
              ...existingTc,
              toolName: tcToolName,
              status: "running",
              args: formatToolArgs(tcToolName, event.arguments),
              agentDescription: agentDesc ?? existingTc?.agentDescription,
            });
            break;
          }

          case "tool_output_delta": {
            // Accumulate streaming output lines
            const existing = renderer.getToolCall(event.callId) ?? {
              toolName: callIdToToolName.get(event.callId) ?? "unknown",
              status: "running" as const,
            };
            const lines = existing.liveOutput ?? [];
            const chunks = event.chunk.split("\n");
            const merged = [...lines];
            if (merged.length > 0 && !event.chunk.startsWith("\n")) {
              merged[merged.length - 1] = (merged[merged.length - 1] ?? "") + chunks[0];
              merged.push(...chunks.slice(1).filter((c: string) => c !== ""));
            } else {
              merged.push(...chunks.filter((c: string) => c !== ""));
            }
            renderer.setToolCall(event.callId, { ...existing, liveOutput: merged });
            break;
          }

          case "tool_call_end": {
            const toolName = callIdToToolName.get(event.callId) ?? event.callId;
            const prevTc = renderer.getToolCall(event.callId);
            const _elapsed = prevTc?.startedAt ? Math.floor((Date.now() - prevTc.startedAt) / 1000) : 0;
            renderer.setToolCall(event.callId, {
              toolName,
              status: event.isError ? "error" : "done",
              output: event.output?.slice(0, 500),
              args: prevTc?.args,
              resultSummary: event.output ? summarizeToolOutput(event.output) : undefined,
              startedAt: prevTc?.startedAt,
            });
            cybergotchiEvents.emit("cybergotchi", { type: event.isError ? "toolError" : "toolSuccess", toolName });
            // Auto-commit with file list
            if (!event.isError && isGitRepo()) {
              const rawArgs = prevTc?.args ?? "";
              const filePath = rawArgs.startsWith("$") ? null : rawArgs;
              const hash = autoCommitAIEdits(toolName, filePath ? [filePath] : [], process.cwd());
              if (hash) {
                // Show changed files in commit message
                let commitMsg = `git: committed ${hash}`;
                try {
                  const { execSync } = await import("node:child_process");
                  const files = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
                    encoding: "utf-8",
                    stdio: ["pipe", "pipe", "pipe"],
                  }).trim();
                  if (files)
                    commitMsg += `\n${files
                      .split("\n")
                      .map((f) => `  ${f}`)
                      .join("\n")}`;
                } catch {
                  /* ignore */
                }
                messages = [...messages, createInfoMessage(commitMsg)];
                cybergotchiEvents.emit("cybergotchi", { type: "commit" });
              }
            }
            break;
          }

          case "cost_update":
            currentModel = event.model;
            cost.record(
              "provider",
              event.model,
              event.inputTokens,
              event.outputTokens,
              event.cost || estimateCost(event.model, event.inputTokens, event.outputTokens),
            );
            renderer.setTokenCount(cost.totalOutputTokens);
            syncRenderer();
            break;

          case "rate_limited":
            renderer.setError(`⏳ Rate limited — retrying in ${event.retryIn}s (attempt ${event.attempt}/3)`);
            break;

          case "error":
            renderer.setError(event.message);
            break;

          case "turn_complete": {
            // Save thinking summary before clearing
            const thinkElapsed = renderer.getThinkingStartedAt()
              ? Math.floor((Date.now() - renderer.getThinkingStartedAt()!) / 1000)
              : 0;
            if (thinkElapsed > 0) {
              renderer.setLastThinkingSummary(`∴ Thought for ${thinkElapsed}s [Ctrl+O]`);
            } else {
              renderer.setLastThinkingSummary(null);
            }
            renderer.setThinkingText("");
            renderer.setThinkingStartedAt(null);
            // Finalize streaming message
            if (accumulated) {
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, content: last.content + accumulated, meta: {} }];
              } else {
                messages = [...messages, createAssistantMessage(accumulated)];
              }
              accumulated = "";
            } else {
              const last = messages[messages.length - 1];
              if (last?.meta?.isStreaming) {
                messages = [...messages.slice(0, -1), { ...last, meta: {} }];
              }
            }
            renderer.setStreamingText("");
            // Collapse all tool calls from this turn (clean up visual noise)
            renderer.collapseAllToolCalls();
            // Save session
            session.messages = messages;
            session.totalCost = cost.totalCost;
            try {
              saveSession(session);
            } catch {
              /* ignore */
            }
            break;
          }
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        renderer.setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      // Preserve partial streaming text on abort
      if (accumulated) {
        const last = messages[messages.length - 1];
        if (last?.meta?.isStreaming) {
          messages = [...messages.slice(0, -1), { ...last, content: last.content + accumulated, meta: {} }];
        } else {
          messages = [...messages, createAssistantMessage(`${accumulated}\n\n[interrupted]`)];
        }
        accumulated = "";
      }
      loading = false;
      abortController = null;
      renderer.setLoading(false);
      renderer.setStreamingText("");
      // Content auto-scrolls via terminal native scrollback
      syncRenderer();
    }
  }

  // Centralized cleanup — ensures terminal is always restored
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    unpublishCard(agentCard.id);
    cronExecutor.stop();
    renderer.stop();
    session.messages = messages;
    session.totalCost = cost.totalCost;
    try {
      saveSession(session);
    } catch {
      /* ignore */
    }
  }

  // Ensure terminal restoration on unexpected exit
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    cleanup();
    console.error("Fatal:", err);
    process.exit(1);
  });

  // Start
  renderer.start();
  // Banner is already printed to stdout by main.tsx (visible in terminal scrollback)
  syncRenderer();
}
