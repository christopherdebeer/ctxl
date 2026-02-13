/**
 * Shared system initialisation.
 *
 * Both <CtxlProvider> (library consumers) and boot.ts (dev environment)
 * call initSystem() so the boot path is identical. This is the single
 * source of truth for: esbuild → IDB → atoms → VFS → runtime → refresh → wasm.
 */
import { createIDB } from "./idb";
import { createAtomRegistry } from "./atoms";
import type { AtomRegistry } from "./atoms";
import { createRuntime } from "./runtime";
import { SEEDS } from "./seeds-v2";
import type { Runtime, IDB, RuntimeCallbacks, ApiMode } from "./types";

export interface InitSystemOptions {
  apiMode?: ApiMode;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  esbuildUrl?: string;
  esbuildWasmUrl?: string;
  dbName?: string;
  seeds?: Map<string, string>;
  callbacks?: RuntimeCallbacks;
  /** Write runtime + atoms to window globals (default true) */
  exposeGlobals?: boolean;
}

export interface InitSystemResult {
  runtime: Runtime;
  atoms: AtomRegistry;
  files: Map<string, string>;
  idb: IDB;
}

/**
 * Boot the ctxl system: esbuild, IDB, atoms, VFS, runtime.
 * Does NOT call buildAndRun — the caller decides when to trigger the first build.
 */
export async function initSystem(options: InitSystemOptions = {}): Promise<InitSystemResult> {
  const {
    apiMode = "none",
    apiKey = "",
    proxyUrl = "/api/chat",
    model = "claude-sonnet-4-5-20250929",
    esbuildUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js",
    esbuildWasmUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm",
    dbName = "ctxl_vfs",
    seeds = SEEDS,
    callbacks = {},
    exposeGlobals = true,
  } = options;

  // 1. Import esbuild
  const esbuild = await import(/* @vite-ignore */ esbuildUrl);

  // 2. IndexedDB
  const idb = createIDB(dbName);

  // 3. Atom registry (persistent shared state)
  const atoms = createAtomRegistry();
  await atoms.hydrate(idb);

  // 4. Load or seed VFS
  const files = new Map<string, string>();
  const rows = await idb.getAll();
  const vfsRows = rows.filter(r => !r.path.startsWith("__atom:"));
  if (vfsRows.length === 0) {
    for (const [p, t] of seeds.entries()) {
      files.set(p, t);
      await idb.put(p, t);
    }
  } else {
    for (const r of vfsRows) files.set(r.path, r.text);
  }

  // 5. Create runtime
  const config = { apiMode, apiKey, proxyUrl, model };
  const runtime = createRuntime({ esbuild, idb, files, config, callbacks });

  // 6. Globals for VFS compatibility
  if (exposeGlobals) {
    (window as any).__RUNTIME__ = runtime;
    (window as any).__ATOMS__ = atoms;
  }

  // 7. React Refresh + esbuild WASM
  await runtime.initRefresh();
  await runtime.initEsbuild(esbuildWasmUrl);

  return { runtime, atoms, files, idb };
}
