import assert from "node:assert";
import { describe, it } from "node:test";
import { createInitialState, createStore } from "./store.js";

describe("createStore", () => {
  it("creates with default state", () => {
    const store = createStore();
    const state = store.getState();
    assert.deepStrictEqual(state.messages, []);
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.currentModel, "");
    assert.strictEqual(state.vimMode, null);
  });

  it("creates with overrides", () => {
    const store = createStore({ currentModel: "llama3", loading: true });
    assert.strictEqual(store.getState().currentModel, "llama3");
    assert.strictEqual(store.getState().loading, true);
  });

  it("setState with object partial", () => {
    const store = createStore();
    store.setState({ loading: true, currentModel: "gpt-4" });
    assert.strictEqual(store.getState().loading, true);
    assert.strictEqual(store.getState().currentModel, "gpt-4");
    // Other fields unchanged
    assert.deepStrictEqual(store.getState().messages, []);
  });

  it("setState with function partial", () => {
    const store = createStore({ inputText: "hello" });
    store.setState((prev) => ({ inputText: `${prev.inputText} world` }));
    assert.strictEqual(store.getState().inputText, "hello world");
  });

  it("notifies subscribers on setState", () => {
    const store = createStore();
    let notified = false;
    store.subscribe(() => {
      notified = true;
    });
    store.setState({ loading: true });
    assert.strictEqual(notified, true);
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore();
    let count = 0;
    const unsub = store.subscribe(() => {
      count++;
    });
    store.setState({ loading: true });
    assert.strictEqual(count, 1);
    unsub();
    store.setState({ loading: false });
    assert.strictEqual(count, 1); // not notified after unsub
  });

  it("multiple subscribers all notified", () => {
    const store = createStore();
    let a = 0,
      b = 0;
    store.subscribe(() => {
      a++;
    });
    store.subscribe(() => {
      b++;
    });
    store.setState({ loading: true });
    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);
  });
});

describe("createInitialState", () => {
  it("returns complete state with defaults", () => {
    const state = createInitialState();
    assert.strictEqual(state.fastMode, false);
    assert.strictEqual(state.acIsPath, false);
    assert.strictEqual(state.session, null);
  });

  it("merges overrides", () => {
    const state = createInitialState({ fastMode: true });
    assert.strictEqual(state.fastMode, true);
    assert.strictEqual(state.loading, false); // other defaults preserved
  });
});
