/**
 * ctxl — Agent Component Library
 *
 * A self-contained runtime for LLM-embodied React components.
 * Components can think (reason within current form) and evolve
 * (rewrite their own source code when current capabilities are insufficient).
 *
 * Usage as ES module:
 *   import { create, DEFAULT_SEEDS } from './ctxl.js';
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

// Re-export all primitives
export { createIDB } from "./idb.js";
export { injectReactRefresh } from "./refresh.js";
export { createVFSPlugin } from "./vfs-plugin.js";
export { createStateStore } from "./state.js";
export { buildThinkPrompt, buildEvolvePrompt } from "./prompts.js";
export { createRuntime } from "./runtime.js";
export { DEFAULT_SEEDS } from "./seeds.js";

// Imports needed by create()
import { createIDB } from "./idb.js";
import { createStateStore } from "./state.js";
import { createRuntime } from "./runtime.js";
import { DEFAULT_SEEDS } from "./seeds.js";

/**
 * High-level API: create and boot a complete agent system.
 *
 * @param options.target      DOM element to mount the agent into (must have id="root" or one will be set)
 * @param options.seeds       VFS seed files (default: DEFAULT_SEEDS with think/evolve agent)
 * @param options.apiMode     'none' | 'anthropic' | 'proxy'
 * @param options.apiKey      Anthropic API key (for apiMode 'anthropic')
 * @param options.proxyUrl    Proxy server URL (for apiMode 'proxy')
 * @param options.esbuildUrl  CDN URL for esbuild-wasm ESM module
 * @param options.esbuildWasmUrl  CDN URL for esbuild.wasm binary
 * @param options.dbName      IndexedDB database name
 * @param options.callbacks   {onStatus, onMode, onFileChange, onBuildStart, onBuildEnd, onError}
 */
export async function create(options = {}) {
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
  const files = new Map();
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
