/**
 * Atom store — scoped external state that survives self-modification.
 *
 * Each atom is a named piece of state with pub/sub semantics.
 * Atoms persist to IndexedDB and survive module reimports, React Refresh,
 * self-modification, and page reloads.
 *
 * Host-side module: creates atoms and manages the registry on window.__ATOMS__.
 * VFS components access atoms via the useAtom hook (src/seeds/ctxl/hooks.ts).
 */
import type { IDB } from "./types";

export interface Atom<T = any> {
  key: string;
  defaultValue: T;
  _value: T;
  _listeners: Set<() => void>;
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export interface AtomRegistry {
  atoms: Map<string, Atom>;
  idb: IDB | null;
  create<T>(key: string, defaultValue: T): Atom<T>;
  get<T>(key: string): Atom<T> | undefined;
  keys(): string[];
  hydrate(idb: IDB): Promise<void>;
}

/** Persist atom value to IDB under the __atom: prefix. */
async function persistAtom(registry: AtomRegistry, key: string, value: any) {
  if (!registry.idb) return;
  try {
    await registry.idb.put(`__atom:${key}`, JSON.stringify(value));
  } catch (e) {
    console.warn("[atoms] persist failed for", key, e);
  }
}

export function createAtomRegistry(): AtomRegistry {
  const registry: AtomRegistry = {
    atoms: new Map(),
    idb: null,

    create<T>(key: string, defaultValue: T): Atom<T> {
      const existing = this.atoms.get(key);
      if (existing) return existing as Atom<T>;

      const atom: Atom<T> = {
        key,
        defaultValue,
        _value: defaultValue,
        _listeners: new Set(),
        get() { return this._value; },
        set(valueOrFn: T | ((prev: T) => T)) {
          const next = typeof valueOrFn === "function"
            ? (valueOrFn as (prev: T) => T)(this._value)
            : valueOrFn;
          if (Object.is(this._value, next)) return;
          this._value = next;
          this._listeners.forEach(fn => fn());
          persistAtom(registry, key, next);
        },
        subscribe(fn: () => void) {
          this._listeners.add(fn);
          return () => { this._listeners.delete(fn); };
        },
      };

      this.atoms.set(key, atom);
      return atom;
    },

    get<T>(key: string): Atom<T> | undefined {
      return this.atoms.get(key) as Atom<T> | undefined;
    },

    keys(): string[] {
      return [...this.atoms.keys()];
    },

    /** Load persisted atom values from IDB. */
    async hydrate(idb: IDB) {
      this.idb = idb;
      const rows = await idb.getAll();
      for (const row of rows) {
        if (!row.path.startsWith("__atom:")) continue;
        const key = row.path.slice("__atom:".length);
        try {
          const value = JSON.parse(row.text);
          const existing = this.atoms.get(key);
          if (existing) {
            existing._value = value;
          }
          // If atom hasn't been created yet, the value will be loaded
          // when create() is called — we store it speculatively.
          if (!existing) {
            // Stash for later hydration when atom is created
            (this as any)._pending ??= new Map();
            (this as any)._pending.set(key, value);
          }
        } catch { /* skip malformed */ }
      }
    },
  };

  // Patch create to check pending hydration
  const originalCreate = registry.create.bind(registry);
  registry.create = function <T>(key: string, defaultValue: T): Atom<T> {
    const atom = originalCreate(key, defaultValue);
    const pending = (registry as any)._pending as Map<string, any> | undefined;
    if (pending?.has(key)) {
      atom._value = pending.get(key);
      pending.delete(key);
    }
    return atom;
  };

  return registry;
}
