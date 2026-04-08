/**
 * TerminalRenderer — cell-level diffing terminal renderer.
 * Replaces Ink for the REPL. Only writes changed characters to stdout.
 */

import { CellGrid } from './cells.js';
import { diff, syncWrite, enterAltScreen, leaveAltScreen, hideCursor, showCursor, moveCursor } from './differ.js';
import { rasterize, type LayoutState, type ToolCallInfo } from './layout.js';
import { createSessionBrowser, browserUp, browserDown, browserSelectedId, browserLoadPreview, browserSearch, type SessionBrowserState } from './session-browser.js';
import { summarizeToolArgs } from '../utils/tool-summary.js';
import { extractDiffInfo } from './diff.js';
import { startRawInput, type KeyEvent } from './input.js';
import type { Message } from '../types/message.js';

export type { KeyEvent } from './input.js';
export type { LayoutState, ToolCallInfo } from './layout.js';

export class TerminalRenderer {
  private current: CellGrid;
  private previous: CellGrid;
  private state: LayoutState;
  private stopInput: (() => void) | null = null;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private renderPending = false;
  private started = false;

  // Callbacks
  private keypressHandler: ((key: KeyEvent) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  // Permission prompt state
  private permissionResolve: ((allowed: boolean) => void) | null = null;
  permissionPrompt: { toolName: string; description: string; riskLevel: string } | null = null;

  // Question prompt state
  private questionResolve: ((answer: string) => void) | null = null;

  // Animation callback (called every 500ms for companion, etc.)
  private animationCallback: ((frame: number) => void) | null = null;

  constructor() {
    const w = process.stdout.columns ?? 80;
    const h = process.stdout.rows ?? 24;
    this.current = new CellGrid(w, h);
    this.previous = new CellGrid(w, h);
    this.state = {
      messages: [],
      streamingText: '',
      thinkingText: '',
      toolCalls: new Map(),
      inputText: '',
      inputCursor: 0,
      companionLines: null,
      companionColor: 'cyan',
      statusHints: 'exit to quit',
      statusLine: '',
      contextWarning: null,
      errorText: null,
      loading: false,
      spinnerFrame: 0,
      thinkingStartedAt: null,
      tokenCount: 0,
      vimMode: null,
      permissionBox: null,
      permissionDiffVisible: false,
      permissionDiffInfo: null,
      expandedToolCalls: new Set(),
      questionPrompt: null,
      autocomplete: [],
      autocompleteDescriptions: [],
      autocompleteIndex: -1,
      manualScroll: 0,
      codeBlocksExpanded: false,
      sessionBrowser: null,
      bannerLines: null,
      thinkingExpanded: false,
      lastThinkingSummary: null,
      searchMode: false,
      searchQuery: '',
      searchMatchCount: 0,
      searchCurrentMatch: -1,
    };
  }

  // ── Lifecycle ──

  start(): void {
    this.started = true;
    enterAltScreen();
    // Enable SGR mouse tracking (scroll wheel support)
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    hideCursor();

    // Raw input
    this.stopInput = startRawInput((key) => {
      // Permission prompt intercepts Y/N
      if (this.permissionResolve) {
        const k = key.char.toLowerCase();
        if (k === 'y') {
          const resolve = this.permissionResolve;
          this.permissionResolve = null;
          this.permissionPrompt = null;
          this.state.permissionBox = null;
          this.state.permissionDiffVisible = false;
          this.state.permissionDiffInfo = null;
          this.scheduleRender();
          resolve(true);
        } else if (k === 'n') {
          const resolve = this.permissionResolve;
          this.permissionResolve = null;
          this.permissionPrompt = null;
          this.state.permissionBox = null;
          this.state.permissionDiffVisible = false;
          this.state.permissionDiffInfo = null;
          this.scheduleRender();
          resolve(false);
        } else if (k === 'd' && this.state.permissionDiffInfo) {
          this.state.permissionDiffVisible = !this.state.permissionDiffVisible;
          this.scheduleRender();
        }
        return; // Swallow all other keys during permission prompt
      }

      // Question prompt intercepts text input
      if (this.questionResolve && this.state.questionPrompt) {
        const qp = this.state.questionPrompt;
        if (key.name === 'return' && qp.input.trim()) {
          const resolve = this.questionResolve;
          const answer = qp.input.trim();
          this.questionResolve = null;
          this.state.questionPrompt = null;
          this.scheduleRender();
          resolve(answer);
        } else if (key.name === 'backspace') {
          if (qp.cursor > 0) {
            this.state.questionPrompt = { ...qp, input: qp.input.slice(0, qp.cursor - 1) + qp.input.slice(qp.cursor), cursor: qp.cursor - 1 };
            this.scheduleRender();
          }
        } else if (key.name === 'left') {
          if (qp.cursor > 0) { this.state.questionPrompt = { ...qp, cursor: qp.cursor - 1 }; this.scheduleRender(); }
        } else if (key.name === 'right') {
          if (qp.cursor < qp.input.length) { this.state.questionPrompt = { ...qp, cursor: qp.cursor + 1 }; this.scheduleRender(); }
        } else if (key.char && key.char.length === 1 && !key.ctrl && !key.meta) {
          this.state.questionPrompt = { ...qp, input: qp.input.slice(0, qp.cursor) + key.char + qp.input.slice(qp.cursor), cursor: qp.cursor + 1 };
          this.scheduleRender();
        }
        return;
      }

      if (this.keypressHandler) this.keypressHandler(key);
    });

    // Animation timer (spinner + companion frames)
    this.animationTimer = setInterval(() => {
      this.state.spinnerFrame++;
      if (this.animationCallback) this.animationCallback(this.state.spinnerFrame);
      if (this.state.loading || this.animationCallback) this.scheduleRender();
    }, 500);

    // Terminal resize
    this.resizeHandler = () => this.handleResize();
    process.stdout.on('resize', this.resizeHandler);

    this.render();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.animationTimer) { clearInterval(this.animationTimer); this.animationTimer = null; }
    if (this.resizeHandler) { process.stdout.off('resize', this.resizeHandler); this.resizeHandler = null; }
    if (this.stopInput) { this.stopInput(); this.stopInput = null; }
    // Restore terminal: disable mouse, leave alt screen, show cursor, reset attributes
    process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[0m');
    showCursor();
    leaveAltScreen();
  }

  // ── State updates ──

  setMessages(msgs: Message[]): void { this.state.messages = msgs; this.scheduleRender(); }
  setStreamingText(text: string): void { this.state.streamingText = text; this.scheduleRender(); }
  setThinkingText(text: string): void { this.state.thinkingText = text; this.scheduleRender(); }
  setError(text: string | null): void { this.state.errorText = text; this.scheduleRender(); }
  setLoading(loading: boolean): void { this.state.loading = loading; this.scheduleRender(); }
  setInputText(text: string): void { this.state.inputText = text; this.scheduleRender(); }
  setInputCursor(pos: number): void { this.state.inputCursor = pos; this.scheduleRender(); }
  setCompanion(lines: string[] | null, color: string): void {
    this.state.companionLines = lines;
    this.state.companionColor = color;
    this.scheduleRender();
  }
  setBanner(lines: string[] | null): void { this.state.bannerLines = lines; this.scheduleRender(); }
  setStatusHints(text: string): void { this.state.statusHints = text; this.scheduleRender(); }
  setAutocomplete(suggestions: string[], index: number, descriptions?: string[]): void {
    this.state.autocomplete = suggestions;
    this.state.autocompleteDescriptions = descriptions ?? [];
    this.state.autocompleteIndex = index;
    this.scheduleRender();
  }
  setStatusLine(text: string): void { this.state.statusLine = text; this.scheduleRender(); }
  setContextWarning(warning: { text: string; critical: boolean } | null): void { this.state.contextWarning = warning; this.scheduleRender(); }
  setVimMode(mode: 'normal' | 'insert' | null): void { this.state.vimMode = mode; this.scheduleRender(); }
  setThinkingStartedAt(time: number | null): void { this.state.thinkingStartedAt = time; }
  getThinkingStartedAt(): number | null { return this.state.thinkingStartedAt; }
  setLastThinkingSummary(summary: string | null): void { this.state.lastThinkingSummary = summary; this.scheduleRender(); }
  toggleThinkingExpanded(): void { this.state.thinkingExpanded = !this.state.thinkingExpanded; this.scheduleRender(); }

  // Search mode
  enterSearchMode(): void {
    this.state.searchMode = true;
    this.state.searchQuery = '';
    this.state.searchMatchCount = 0;
    this.state.searchCurrentMatch = -1;
    this.scheduleRender();
  }
  exitSearchMode(): void {
    this.state.searchMode = false;
    this.state.searchQuery = '';
    this.state.searchMatchCount = 0;
    this.state.searchCurrentMatch = -1;
    this.scheduleRender();
  }
  setSearchQuery(query: string): void {
    this.state.searchQuery = query;
    // Count matches across all messages
    if (query) {
      const lq = query.toLowerCase();
      let count = 0;
      for (const msg of this.state.messages) {
        const content = msg.content.toLowerCase();
        let idx = 0;
        while ((idx = content.indexOf(lq, idx)) !== -1) { count++; idx += lq.length; }
      }
      this.state.searchMatchCount = count;
      this.state.searchCurrentMatch = count > 0 ? 0 : -1;
    } else {
      this.state.searchMatchCount = 0;
      this.state.searchCurrentMatch = -1;
    }
    this.scheduleRender();
  }
  searchNext(): void {
    if (this.state.searchMatchCount > 0) {
      this.state.searchCurrentMatch = (this.state.searchCurrentMatch + 1) % this.state.searchMatchCount;
      this.scheduleRender();
    }
  }
  searchPrev(): void {
    if (this.state.searchMatchCount > 0) {
      this.state.searchCurrentMatch = (this.state.searchCurrentMatch - 1 + this.state.searchMatchCount) % this.state.searchMatchCount;
      this.scheduleRender();
    }
  }
  isSearchMode(): boolean { return this.state.searchMode; }
  getSearchQuery(): string { return this.state.searchQuery; }
  setTokenCount(count: number): void { this.state.tokenCount = count; this.scheduleRender(); }

  scrollUp(rows: number): void {
    this.state.manualScroll += rows;
    this.scheduleRender();
  }
  scrollDown(rows: number): void {
    this.state.manualScroll = Math.max(0, this.state.manualScroll - rows);
    this.scheduleRender();
  }
  scrollToBottom(): void {
    this.state.manualScroll = 0;
    this.scheduleRender();
  }
  toggleCodeBlockExpansion(): void {
    this.state.codeBlocksExpanded = !this.state.codeBlocksExpanded;
    this.scheduleRender();
  }

  // Session browser
  openSessionBrowser(): void {
    this.state.sessionBrowser = createSessionBrowser();
    this.scheduleRender();
  }
  closeSessionBrowser(): void {
    this.state.sessionBrowser = null;
    this.scheduleRender();
  }
  sessionBrowserUp(): void {
    if (this.state.sessionBrowser) {
      this.state.sessionBrowser = browserLoadPreview(browserUp(this.state.sessionBrowser));
      this.scheduleRender();
    }
  }
  sessionBrowserDown(): void {
    if (this.state.sessionBrowser) {
      this.state.sessionBrowser = browserLoadPreview(browserDown(this.state.sessionBrowser));
      this.scheduleRender();
    }
  }
  sessionBrowserSelect(): string | null {
    if (!this.state.sessionBrowser) return null;
    const id = browserSelectedId(this.state.sessionBrowser);
    this.state.sessionBrowser = null;
    this.scheduleRender();
    return id;
  }
  sessionBrowserType(char: string): void {
    if (this.state.sessionBrowser) {
      this.state.sessionBrowser = browserSearch(this.state.sessionBrowser, this.state.sessionBrowser.searchQuery + char);
      this.scheduleRender();
    }
  }
  sessionBrowserBackspace(): void {
    if (this.state.sessionBrowser && this.state.sessionBrowser.searchQuery.length > 0) {
      this.state.sessionBrowser = browserSearch(this.state.sessionBrowser, this.state.sessionBrowser.searchQuery.slice(0, -1));
      this.scheduleRender();
    }
  }
  isSessionBrowserOpen(): boolean {
    return this.state.sessionBrowser !== null;
  }
  setToolCall(callId: string, info: ToolCallInfo): void {
    this.state.toolCalls.set(callId, info);
    this.scheduleRender();
  }
  getToolCall(callId: string): ToolCallInfo | undefined { return this.state.toolCalls.get(callId); }
  clearToolCalls(): void { this.state.toolCalls.clear(); this.scheduleRender(); }

  /** Show a question prompt and wait for text answer */
  askQuestion(question: string, options?: string[]): Promise<string> {
    this.state.questionPrompt = { question, options: options ?? null, input: '', cursor: 0 };
    this.scheduleRender();
    return new Promise((resolve) => {
      this.questionResolve = resolve;
    });
  }

  // Expanded tool call tracking

  toggleToolCallExpanded(callId: string): void {
    const expanded = this.state.expandedToolCalls;
    if (expanded.has(callId)) {
      expanded.delete(callId);
    } else {
      expanded.add(callId);
    }
    this.scheduleRender();
  }

  /** Cycle to next tool call and toggle its expansion */
  cycleToolCallExpansion(): void {
    const ids = [...this.state.toolCalls.keys()].filter(id => {
      const tc = this.state.toolCalls.get(id);
      return tc && tc.status !== 'running' && tc.output;
    });
    if (ids.length === 0) return;

    const expanded = this.state.expandedToolCalls;
    const currentIdx = ids.findIndex(id => expanded.has(id));
    if (currentIdx >= 0) {
      expanded.delete(ids[currentIdx]!);
      const nextIdx = currentIdx + 1;
      if (nextIdx < ids.length) {
        expanded.add(ids[nextIdx]!);
      }
    } else {
      expanded.add(ids[0]!);
    }
    this.scheduleRender();
  }

  /** Show permission prompt and wait for Y/N response */
  askPermission(toolName: string, description: string, riskLevel: string): Promise<boolean> {
    this.permissionPrompt = { toolName, description, riskLevel };
    this.state.permissionBox = { toolName, description, riskLevel, suggestion: summarizeToolArgs(toolName, description) };
    this.state.permissionDiffVisible = false;
    this.state.permissionDiffInfo = extractDiffInfo(toolName, description);
    this.scheduleRender();
    return new Promise((resolve) => {
      this.permissionResolve = resolve;
    });
  }

  // ── Input ──

  onKeypress(handler: (key: KeyEvent) => void): void {
    this.keypressHandler = handler;
  }

  onAnimation(handler: (frame: number) => void): void {
    this.animationCallback = handler;
  }

  // ── Rendering ──

  private scheduleRender(): void {
    if (this.renderPending || !this.started) return;
    this.renderPending = true;
    queueMicrotask(() => {
      this.renderPending = false;
      if (this.started) this.render();
    });
  }

  private render(): void {
    const w = process.stdout.columns ?? 80;
    const h = process.stdout.rows ?? 24;

    // Resize if needed
    if (w !== this.current.width || h !== this.current.height) {
      this.current = new CellGrid(w, h);
      this.previous = new CellGrid(w, h); // force full repaint
    }

    this.current.clear();
    const cursor = rasterize(this.state, this.current);

    const output = diff(this.previous, this.current);
    if (output) {
      syncWrite(output);
    }

    // Show cursor at input position
    moveCursor(cursor.cursorRow, cursor.cursorCol);
    showCursor();

    // Swap buffers
    this.previous = this.current.clone();
  }

  private handleResize(): void {
    // Force full repaint on resize
    this.previous = new CellGrid(1, 1);
    this.scheduleRender();
  }
}
