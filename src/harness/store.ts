/**
 * REPL state store — centralized state management for the interactive REPL.
 *
 * Simple reactive store inspired by Zustand but without React dependency.
 * State is modified via setState() which notifies subscribers.
 */

import type { Message } from "../types/message.js";
import type { Session } from "./session.js";

export type REPLState = {
  // Core conversation
  messages: Message[];
  loading: boolean;
  currentModel: string;

  // Input
  inputText: string;
  inputCursor: number;
  inputHistory: string[];
  historyIndex: number;

  // UI modes
  vimMode: "normal" | "insert" | null;
  fastMode: boolean;
  companionVisible: boolean;

  // Autocomplete
  acSuggestions: string[];
  acDescriptions: string[];
  acIndex: number;
  acTokenStart: number;
  acIsPath: boolean;

  // Session
  session: Session | null;

  // Tracking
  estimatedTokenCount: number;
  lastMessageCount: number;
};

export function createInitialState(overrides?: Partial<REPLState>): REPLState {
  return {
    messages: [],
    loading: false,
    currentModel: "",
    inputText: "",
    inputCursor: 0,
    inputHistory: [],
    historyIndex: -1,
    vimMode: null,
    fastMode: false,
    companionVisible: true,
    acSuggestions: [],
    acDescriptions: [],
    acIndex: -1,
    acTokenStart: 0,
    acIsPath: false,
    session: null,
    estimatedTokenCount: 0,
    lastMessageCount: 0,
    ...overrides,
  };
}

export type Subscriber = (state: REPLState) => void;

export type Store = {
  getState: () => REPLState;
  setState: (partial: Partial<REPLState> | ((prev: REPLState) => Partial<REPLState>)) => void;
  subscribe: (fn: Subscriber) => () => void;
};

/**
 * Create a simple reactive store.
 *
 * Usage:
 *   const store = createStore({ currentModel: 'llama3' });
 *   store.subscribe(state => renderer.setMessages(state.messages));
 *   store.setState({ loading: true });
 *   store.setState(prev => ({ messages: [...prev.messages, newMsg] }));
 */
export function createStore(initial?: Partial<REPLState>): Store {
  let state = createInitialState(initial);
  const subscribers = new Set<Subscriber>();

  return {
    getState: () => state,

    setState(partial) {
      const updates = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...updates };
      for (const fn of subscribers) fn(state);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
