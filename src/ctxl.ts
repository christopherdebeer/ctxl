/**
 * ctxl — Agent Component Library
 *
 * A self-contained runtime for LLM-embodied React components.
 * Components can think (reason within current form) and evolve
 * (rewrite their own source code when current capabilities are insufficient).
 *
 * Usage as ES module:
 *   import { create, DEFAULT_SEEDS } from './ctxl';
 *   const system = await create({ target: el, apiMode: 'proxy' });
 *
 * Usage as script:
 *   <script type="module">
 *     const { create } = await import('./src/ctxl.js');
 *     await create({ target: document.getElementById('root'), apiMode: 'proxy' });
 *   </script>
 *
 * Requirements — the host page must include an import map for the VFS runtime:
 *   react, react/jsx-runtime, react-dom/client, react-refresh/runtime, styled-components
 */
import type { CreateOptions, CreateResult } from "./types";

// Re-export all primitives
export { createIDB } from "./idb";
export { injectReactRefresh } from "./refresh";
export { createVFSPlugin } from "./vfs-plugin";
export { createStateStore } from "./state";
export { buildThinkPrompt, buildEvolvePrompt } from "./prompts";
export { createRuntime } from "./runtime";
export { DEFAULT_SEEDS } from "./seeds";

// Re-export types
export type {
  IDB,
  VFSRow,
  StateStore,
  AgentMemory,
  StateMeta,
  RuntimeConfig,
  ApiMode,
  LLMResult,
  ThinkResult,
  RuntimeCallbacks,
  FilePatch,
  EsbuildPlugin,
  Esbuild,
  Runtime,
  RuntimeOptions,
  CreateOptions,
  CreateResult,
} from "./types";

// Imports needed by create()
import { createIDB } from "./idb";
import { createStateStore } from "./state";
import { createRuntime } from "./runtime";
import { DEFAULT_SEEDS } from "./seeds";

/**
 * High-level API: create and boot a complete agent system.
 */
export async function create(options: CreateOptions = {}): Promise<CreateResult> {
  const {
    target,
    seeds = DEFAULT_SEEDS,
    apiMode = "none",
    apiKey = "",
    proxyUrl = "/api/chat",
    esbuildUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js",
    esbuildWasmUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm",
    dbName = "ctxl_vfs",
    callbacks = {},
  } = options;

  // 1. Import esbuild
  const esbuild = await import(/* @vite-ignore */ esbuildUrl);

  // 2. IndexedDB
  const idb = createIDB(dbName);

  // 3. State store
  const stateStore = createStateStore();
  window.__AGENT_STATE__ = stateStore;

  // 4. Load or seed VFS
  const files = new Map<string, string>();
  const rows = await idb.getAll();
  if (rows.length === 0) {
    for (const [p, t] of seeds.entries()) {
      files.set(p, t);
      await idb.put(p, t);
    }
  } else {
    for (const r of rows) files.set(r.path, r.text);
  }

  // 5. Create runtime
  const config = { apiMode, apiKey, proxyUrl };
  const runtime = createRuntime({ esbuild, idb, stateStore, files, config, callbacks });
  window.__RUNTIME__ = runtime;

  // 6. Ensure target element
  if (target && !target.id) target.id = "root";

  // 7. Initialize and boot
  await runtime.initRefresh();
  await runtime.initEsbuild(esbuildWasmUrl);
  await runtime.buildAndRun("create");

  return { runtime, files, stateStore, idb };
}

// Register on window for script-tag usage
if (typeof window !== "undefined") {
  window.ctxl = { create, createRuntime, createStateStore, createIDB, DEFAULT_SEEDS };
}
