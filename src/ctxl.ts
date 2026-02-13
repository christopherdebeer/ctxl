/**
 * ctxl — Self-Authoring React Component Library
 *
 * A runtime for LLM-embodied React components that author themselves on first
 * mount, reason about input changes via hooks, and can rewrite their own source.
 *
 * Usage as ES module:
 *   import { create } from './ctxl';
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
export { createAtomRegistry } from "./atoms";
export { callLLM, extractText, extractToolUse } from "./llm";
export { buildAuthoringPrompt, buildReasoningContext } from "./prompts";
export { createRuntime } from "./runtime";
export { SEEDS } from "./seeds-v2";

// Re-export types
export type {
  IDB,
  VFSRow,
  RuntimeConfig,
  ApiMode,
  RuntimeCallbacks,
  FilePatch,
  EsbuildPlugin,
  Esbuild,
  Runtime,
  RuntimeOptions,
  CreateOptions,
  CreateResult,
  ToolDef,
  ReasoningResult,
  MutationRecord,
} from "./types";

// Imports needed by create()
import { createIDB } from "./idb";
import { createAtomRegistry } from "./atoms";
import { createRuntime } from "./runtime";
import { SEEDS } from "./seeds-v2";

/**
 * High-level API: create and boot a complete system.
 */
export async function create(options: CreateOptions = {}): Promise<CreateResult> {
  const {
    target,
    seeds = SEEDS,
    apiMode = "none",
    apiKey = "",
    proxyUrl = "/api/chat",
    model = "claude-sonnet-4-5-20250929",
    esbuildUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js",
    esbuildWasmUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm",
    dbName = "ctxl_vfs",
    callbacks = {},
  } = options;

  // 1. Import esbuild
  const esbuild = await import(/* @vite-ignore */ esbuildUrl);

  // 2. IndexedDB
  const idb = createIDB(dbName);

  // 3. Atom registry (persistent shared state)
  const atomRegistry = createAtomRegistry();
  await atomRegistry.hydrate(idb);
  (window as any).__ATOMS__ = atomRegistry;

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
  window.__RUNTIME__ = runtime;

  // 6. Ensure target element
  if (target && !target.id) target.id = "root";

  // 7. Initialize and boot
  await runtime.initRefresh();
  await runtime.initEsbuild(esbuildWasmUrl);
  await runtime.buildAndRun("create");

  return { runtime, files, idb };
}

// Register on window for script-tag usage
if (typeof window !== "undefined") {
  window.ctxl = { create, createRuntime, createAtomRegistry, createIDB, SEEDS };
}
