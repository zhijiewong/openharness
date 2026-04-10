/**
 * TerminalRenderer — sequential output terminal renderer.
 * Flushed messages flow to scrollback; live area is rewritten in-place
 * right after the scrollback content each frame (no absolute positioning gap).
 */

import { CellGrid } from './cells.js';
import { styleToSGR, syncWrite, hideCursor, showCursor } from './differ.js';
import { rasterizeLive, type LayoutState, type ToolCallInfo } from './layout.js';
import { getTheme } from '../utils/theme-data.js';
import { FG } from './colors.js';
import { createSessionBrowser, browserUp, browserDown, browserSelectedId, browserLoadPreview, browserSearch, type SessionBrowserState } from './session-browser.js';
import { summarizeToolArgs } from '../utils/tool-summary.js';
import { extractDiffInfo } from './diff.js';
import { startRawInput, type KeyEvent } from './input.js';
import type { Message } from '../types/message.js';

export type { KeyEvent } from './input.js';
export type { LayoutState, ToolCallInfo } from './layout.js';

export class TerminalRenderer {
  private current: CellGrid;
  private state: LayoutState;
  private stopInput: (() => void) | null = null;
  private notifyTimers: ReturnType<typeof setTimeout>[] = [];
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private renderPending = false;
  private started = false;
  private flushedMessageCount = 0;
  private flushedToolCallIds = new Set<string>();
  private lastLiveLines = 0; // lines the live area occupied last frame (for relative cursor movement)

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
      notifications: [],
    };
  }

  // ── Lifecycle ──

  start(): void {
    this.started = true;
    // Enable SGR mouse tracking (scroll wheel support)
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    hideCursor();

    // Raw input
    this.stopInput = startRawInput((key) => {
      if (this.handlePermissionKey(key)) return;
      if (this.handleQuestionKey(key)) return;
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
    for (const t of this.notifyTimers) clearTimeout(t);
    this.notifyTimers.length = 0;
    // Restore terminal: disable mouse, show cursor, reset attributes
    process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[0m');
    showCursor();
    // Move past live area for clean shell prompt
    process.stdout.write('\n');
  }

  // ── State updates ──

  setMessages(msgs: Message[]): void {
    // Reset flush counter if messages array was replaced (e.g., session resume)
    if (msgs.length < this.flushedMessageCount) this.flushedMessageCount = 0;
    this.state.messages = msgs;
    this.scheduleRender();
  }
  setStreamingText(text: string): void { this.state.streamingText = text; this.scheduleRender(); }
  setThinkingText(text: string): void { this.state.thinkingText = text; this.scheduleRender(); }
  setError(text: string | null): void { this.state.errorText = text; this.scheduleRender(); }

  /** Show a toast notification above the input for 5 seconds */
  notify(text: string): void {
    const entry = { text };
    this.state.notifications.push(entry);
    this.scheduleRender();
    const timer = setTimeout(() => {
      const idx = this.state.notifications.indexOf(entry);
      if (idx >= 0) {
        this.state.notifications.splice(idx, 1);
        this.scheduleRender();
      }
      const ti = this.notifyTimers.indexOf(timer);
      if (ti >= 0) this.notifyTimers.splice(ti, 1);
    }, 5000);
    this.notifyTimers.push(timer);
  }
  scrollBy(delta: number): void {
    this.state.manualScroll = Math.max(0, Math.min(this.state.manualScroll + delta, 500));
    this.scheduleRender();
  }
  setLoading(loading: boolean): void { this.state.loading = loading; this.scheduleRender(); }
  setInputText(text: string): void { this.state.inputText = text; this.scheduleRender(); }
  setInputCursor(pos: number): void { this.state.inputCursor = pos; this.scheduleRender(); }
  setCompanion(lines: string[] | null, color: string): void {
    this.state.companionLines = lines;
    this.state.companionColor = color;
    this.scheduleRender();
  }
  setStatusHints(text: string): void { this.state.statusHints = text; this.scheduleRender(); }
  setBannerLines(lines: string[]): void { this.state.bannerLines = lines; this.scheduleRender(); }
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

  setTokenCount(count: number): void { this.state.tokenCount = count; this.scheduleRender(); }
  toggleCodeBlockExpansion(): void {
    this.state.codeBlocksExpanded = !this.state.codeBlocksExpanded;
    this.scheduleRender();
  }

  // Session browser

  private withSessionBrowser(fn: (sb: SessionBrowserState) => SessionBrowserState): void {
    if (this.state.sessionBrowser) {
      this.state.sessionBrowser = fn(this.state.sessionBrowser);
      this.scheduleRender();
    }
  }
  openSessionBrowser(): void {
    this.state.sessionBrowser = createSessionBrowser();
    this.scheduleRender();
  }
  closeSessionBrowser(): void {
    this.state.sessionBrowser = null;
    this.scheduleRender();
  }
  sessionBrowserUp(): void {
    this.withSessionBrowser(sb => browserLoadPreview(browserUp(sb)));
  }
  sessionBrowserDown(): void {
    this.withSessionBrowser(sb => browserLoadPreview(browserDown(sb)));
  }
  sessionBrowserSelect(): string | null {
    if (!this.state.sessionBrowser) return null;
    const id = browserSelectedId(this.state.sessionBrowser);
    this.state.sessionBrowser = null;
    this.scheduleRender();
    return id;
  }
  sessionBrowserType(char: string): void {
    this.withSessionBrowser(sb => browserSearch(sb, sb.searchQuery + char));
  }
  sessionBrowserBackspace(): void {
    if (this.state.sessionBrowser && this.state.sessionBrowser.searchQuery.length > 0) {
      this.withSessionBrowser(sb => browserSearch(sb, sb.searchQuery.slice(0, -1)));
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
  clearToolCalls(): void { this.state.toolCalls.clear(); this.flushedToolCallIds.clear(); this.scheduleRender(); }
  collapseAllToolCalls(): void { this.state.expandedToolCalls.clear(); this.scheduleRender(); }

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
    this.state.permissionDiffInfo = extractDiffInfo(toolName, description);
    // Auto-show diffs for file-modifying tools
    const isFileTool = /^(Edit|Write|FileEdit|FileWrite)/i.test(toolName);
    this.state.permissionDiffVisible = isFileTool && this.state.permissionDiffInfo !== null;
    this.scheduleRender();
    return new Promise((resolve) => {
      this.permissionResolve = resolve;
    });
  }

  // ── Input ──

  /** Clear the live area from screen using relative cursor movement */
  clearLiveArea(): void {
    if (!this.started) return;
    const cmd = this.lastLiveLines > 0
      ? `\x1b[${this.lastLiveLines}A\r\x1b[J`
      : '\r\x1b[J';
    syncWrite(cmd);
    this.lastLiveLines = 0;
  }

  onKeypress(handler: (key: KeyEvent) => void): void {
    this.keypressHandler = handler;
  }

  onAnimation(handler: (frame: number) => void): void {
    this.animationCallback = handler;
  }

  // ── Input routing ──

  /** Handle permission prompt keys (Y/N/D). Returns true if key was consumed. */
  private handlePermissionKey(key: KeyEvent): boolean {
    if (!this.permissionResolve) return false;
    const k = key.char.toLowerCase();
    if (k === 'y' || k === 'n') {
      const resolve = this.permissionResolve;
      this.permissionResolve = null;
      this.permissionPrompt = null;
      this.state.permissionBox = null;
      this.state.permissionDiffVisible = false;
      this.state.permissionDiffInfo = null;
      this.scheduleRender();
      resolve(k === 'y');
    } else if (k === 'd' && this.state.permissionDiffInfo) {
      this.state.permissionDiffVisible = !this.state.permissionDiffVisible;
      this.scheduleRender();
    }
    return true; // Swallow all keys during permission prompt
  }

  /** Handle question prompt text input. Returns true if key was consumed. */
  private handleQuestionKey(key: KeyEvent): boolean {
    if (!this.questionResolve || !this.state.questionPrompt) return false;
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
    return true;
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

  /** Apply lightweight markdown styling to a line for scrollback output */
  private styleMarkdownLine(line: string): string {
    return line
      .replace(/\*\*(.+?)\*\*/g, '\x1b[1m$1\x1b[0m') // bold → full reset after
      .replace(/`([^`]+)`/g, '\x1b[2m$1\x1b[0m') // inline code → dim, full reset after
      .replace(/^(#{1,3})\s+(.+)$/, '\x1b[1m\x1b[36m$1 $2\x1b[0m'); // headings → bold cyan
  }

  /** Calculate the max text width for flushed scrollback output, reserving space for companion */
  private flushTextWidth(): number {
    const maxWidth = process.stdout.columns ?? 80;
    if (!this.state.companionLines) return maxWidth;
    const compWidth = Math.max(...this.state.companionLines.map(l => l.length), 0) + 2;
    return Math.max(40, maxWidth - compWidth);
  }

  /** Flush completed messages to terminal scrollback (native scrollbar) */
  flushMessages(): void {
    const messages = this.state.messages;
    let didFlush = false;
    const textWidth = this.flushTextWidth();
    while (this.flushedMessageCount < messages.length) {
      const msg = messages[this.flushedMessageCount]!;
      // Don't flush the message currently being streamed
      if (this.state.loading && this.flushedMessageCount === messages.length - 1 && msg.meta?.isStreaming) break;

      const t = getTheme();
      const colorCode = msg.role === 'user' ? `\x1b[${FG(t.user)}m\x1b[1m` : msg.role === 'assistant' ? `\x1b[${FG(t.assistant)}m` : '\x1b[2m';
      const prefixChar = msg.role === 'user' ? '❯ ' : msg.role === 'assistant' ? '◆ ' : '  ';
      const lines = msg.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const styledLine = msg.role === 'assistant' ? this.styleMarkdownLine(lines[i]!) : lines[i]!;
        const linePrefix = i === 0 ? prefixChar : '  ';
        const fullLine = linePrefix + styledLine;
        process.stdout.write(colorCode + fullLine.slice(0, textWidth) + '\x1b[0m\n');
      }
      // Divider after each message
      process.stdout.write('\x1b[2m' + '─'.repeat(Math.min(60, textWidth)) + '\x1b[0m\n');
      this.flushedMessageCount++;
      didFlush = true;
    }

    // Flush completed tool calls as single-line summaries (once each)
    if (didFlush) {
      for (const [callId, tc] of this.state.toolCalls) {
        if (tc.status === 'running') continue;
        if (this.flushedToolCallIds.has(callId)) continue;
        this.flushedToolCallIds.add(callId);
        const t = getTheme();
        const icon = tc.status === 'done' ? `\x1b[${FG(t.success)}m✓` : `\x1b[${FG(t.error)}m✗`;
        const summary = tc.resultSummary ? `  ${tc.resultSummary}` : '';
        const elapsed = tc.startedAt ? ` · ${Math.floor((Date.now() - tc.startedAt) / 1000)}s` : '';
        const toolLine = `${icon} ${tc.toolName}\x1b[0m \x1b[2m${tc.args ?? ''}${summary}${elapsed}\x1b[0m`;
        process.stdout.write(toolLine.slice(0, textWidth) + '\n');
      }
    }
  }

  /** Convert a CellGrid to sequential ANSI output (line-by-line, no absolute positioning) */
  private renderGridToAnsi(grid: CellGrid): string {
    const parts: string[] = [];
    for (let r = 0; r < grid.height; r++) {
      // Find last non-space cell to avoid writing trailing whitespace
      let lastCol = grid.width - 1;
      while (lastCol >= 0 && grid.cells[r]![lastCol]!.char === ' ' && !grid.cells[r]![lastCol]!.style.bg) {
        lastCol--;
      }
      let lastStyle = '';
      for (let c = 0; c <= lastCol; c++) {
        const cell = grid.cells[r]![c]!;
        const sgr = styleToSGR(cell.style);
        if (sgr !== lastStyle) {
          parts.push(sgr);
          lastStyle = sgr;
        }
        parts.push(cell.char);
      }
      parts.push('\x1b[0m\x1b[K'); // reset + erase to end of line (clear stale content)
      if (r < grid.height - 1) parts.push('\n');
    }
    return parts.join('');
  }

  private render(): void {
    const w = process.stdout.columns ?? 80;
    const h = process.stdout.rows ?? 24;

    // 1. Build erase command: move UP to start of old live area, erase below.
    let eraseCmd = '';
    if (this.lastLiveLines > 0) {
      eraseCmd += `\x1b[${this.lastLiveLines}A`;
    }
    eraseCmd += '\r\x1b[J';

    // 2. Flush completed messages to scrollback
    //    If nothing to flush, we combine erase + rewrite into a single
    //    atomic syncWrite to prevent any flickering.
    const hasFlush = this.hasPendingFlush();
    if (hasFlush) {
      syncWrite('\x1b[?25l' + eraseCmd); // hide cursor + erase
      this.flushMessages();
    }

    // 3. Calculate and render new live area
    const liveHeight = Math.min(h, this.calculateLiveHeight());
    if (w !== this.current.width || liveHeight !== this.current.height) {
      this.current = new CellGrid(w, liveHeight);
    }
    this.current.clear();
    const cursor = rasterizeLive(this.state, this.current);

    // 4. Write EVERYTHING in one atomic syncWrite: hide cursor, erase, content,
    //    position cursor, show cursor. Terminal paints this as a single frame.
    const liveOutput = this.renderGridToAnsi(this.current);
    const upFromEnd = liveHeight - 1 - cursor.cursorRow;
    const cursorPos = (upFromEnd > 0 ? `\x1b[${upFromEnd}A` : '') +
      `\x1b[${cursor.cursorCol + 1}G`;

    syncWrite(
      (hasFlush ? '' : '\x1b[?25l' + eraseCmd) + // hide + erase (if not already done)
      liveOutput + '\r' + cursorPos +
      '\x1b[?25h'                                  // show cursor at final position
    );

    this.lastLiveLines = cursor.cursorRow;
  }

  /** Check if there are messages pending flush (without flushing) */
  private hasPendingFlush(): boolean {
    if (this.flushedMessageCount >= this.state.messages.length) return false;
    const msg = this.state.messages[this.flushedMessageCount]!;
    if (this.state.loading && this.flushedMessageCount === this.state.messages.length - 1 && msg.meta?.isStreaming) return false;
    return true;
  }

  /** Estimate the height needed for the live area */
  private calculateLiveHeight(): number {
    let rows = 3; // border + input + hints (minimum)
    // Banner only shown when no messages and not loading (must match rasterizeLive condition)
    if (this.state.bannerLines && this.state.messages.length === 0 && !this.state.loading) {
      rows += this.state.bannerLines.length + 1;
    }
    if (this.state.loading && this.state.streamingText) rows += Math.min(this.state.streamingText.split('\n').length, 10);
    if (this.state.thinkingText) rows += this.state.thinkingExpanded ? 10 : 1;
    if (!this.state.loading && this.state.lastThinkingSummary) rows += 1;
    if (this.state.loading && !this.state.streamingText && !this.state.thinkingText) rows += 1; // spinner
    if (this.state.errorText) rows += 1;
    for (const [, tc] of this.state.toolCalls) {
      rows += 2; // header + possible description/agent line
      if (tc.status === 'running' && tc.liveOutput) rows += Math.min(tc.liveOutput.length, 3);
    }
    if (this.state.contextWarning) rows += 1;
    rows += Math.min(this.state.notifications.length, 2); // toast notifications
    if (this.state.statusLine) rows += 1;
    rows += this.state.autocomplete.length;
    if (this.state.permissionBox) {
      rows += 3;
      if (this.state.permissionDiffVisible && this.state.permissionDiffInfo) rows += 15;
    }
    if (this.state.questionPrompt) rows += 3 + (this.state.questionPrompt.options?.length ?? 0);
    if (this.state.companionLines) rows = Math.max(rows, this.state.companionLines.length + 2);
    const inputLineCount = Math.min(5, (this.state.inputText.match(/\n/g)?.length ?? 0) + 1);
    rows += inputLineCount - 1;
    const h = process.stdout.rows ?? 24;
    // On initial screen with banner, fill the terminal
    if (this.state.bannerLines && this.state.messages.length === 0 && !this.state.loading) {
      return h;
    }
    return Math.min(rows, Math.floor(h * 0.7)); // never exceed 70% of terminal
  }

  private handleResize(): void {
    this.scheduleRender();
  }
}
