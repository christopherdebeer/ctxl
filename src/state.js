/**
 * External state store.
 *
 * Lives on window.__AGENT_STATE__ and survives self-modification,
 * module reimports, crashes, and full rebuilds. Uses immutable
 * update semantics (new object ref on set) for useSyncExternalStore.
 */
export function createStateStore(initial = {}) {
  return {
    memory: { ...initial },
    meta: { cycle: 0, mutations: [], thinkHistory: [] },
    _listeners: new Set(),
    get() { return this.memory; },
    set(patch) {
      this.memory = { ...this.memory, ...patch };
      this._notify();
    },
    subscribe(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },
    _notify() {
      this._listeners.forEach(fn => fn(this.memory));
    },
  };
}
