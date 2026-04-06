/**
 * TerminalRenderer — cell-level diffing terminal renderer.
 * Replaces Ink for the REPL. Only writes changed characters to stdout.
 */

import { CellGrid } from './cells.js';
import { diff, syncWrite, clearScreen, hideCursor, showCursor, moveCursor } from './differ.js';
import { rasterize, type LayoutState, type ToolCallInfo } from './layout.js';
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

  // Permission prompt state
  private permissionResolve: ((allowed: boolean) => void) | null = null;
  permissionPrompt: { toolName: string; description: string; riskLevel: string } | null = null;

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
      errorText: null,
      loading: false,
      spinnerFrame: 0,
      vimMode: null,
    };
  }

  // ── Lifecycle ──

  start(): void {
    this.started = true;
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
          this.state.errorText = null;
          this.scheduleRender();
          resolve(true);
        } else if (k === 'n') {
          const resolve = this.permissionResolve;
          this.permissionResolve = null;
          this.permissionPrompt = null;
          this.state.errorText = null;
          this.scheduleRender();
          resolve(false);
        }
        return; // Swallow all other keys during permission prompt
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
    process.stdout.on('resize', () => this.handleResize());

    this.render();
  }

  stop(): void {
    this.started = false;
    if (this.animationTimer) { clearInterval(this.animationTimer); this.animationTimer = null; }
    if (this.stopInput) { this.stopInput(); this.stopInput = null; }
    showCursor();
    // Move cursor to bottom
    moveCursor((process.stdout.rows ?? 24) - 1, 0);
    process.stdout.write('\n');
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
  setStatusHints(text: string): void { this.state.statusHints = text; this.scheduleRender(); }
  setVimMode(mode: 'normal' | 'insert' | null): void { this.state.vimMode = mode; this.scheduleRender(); }
  setToolCall(callId: string, info: ToolCallInfo): void {
    this.state.toolCalls.set(callId, info);
    this.scheduleRender();
  }
  clearToolCalls(): void { this.state.toolCalls.clear(); this.scheduleRender(); }

  /** Show permission prompt and wait for Y/N response */
  askPermission(toolName: string, description: string, riskLevel: string): Promise<boolean> {
    this.permissionPrompt = { toolName, description, riskLevel };
    this.state.errorText = `⚠ ${toolName} (${riskLevel} risk) — ${description.slice(0, 60)}  [Y/N]`;
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
