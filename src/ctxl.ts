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
 * Usage with React provider (recommended for existing apps):
 *   import { CtxlProvider } from './ctxl';
 *   <CtxlProvider apiMode="proxy">
 *     <AbstractComponent id="chat" inputs={{ topic: "React" }} />
 *   </CtxlProvider>
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

// Shared init (used by CtxlProvider and boot.ts)
export { initSystem } from "./init";
export type { InitSystemOptions, InitSystemResult } from "./init";

// React provider for library consumers
export { CtxlProvider, useCtxlRuntime, HostRuntimeContext } from "./context";
export type { CtxlProviderProps, RuntimeContextValue } from "./context";

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
  UseReasoningReturn,
  ReasoningResult,
  MutationRecord,
} from "./types";

// Imports needed by create()
import { initSystem } from "./init";
import { createRuntime } from "./runtime";
import { createAtomRegistry } from "./atoms";
import { createIDB } from "./idb";
import { SEEDS } from "./seeds-v2";

/**
 * High-level API: create and boot a complete system.
 *
 * Uses the same initSystem() code path as <CtxlProvider>,
 * then triggers the first buildAndRun.
 */
export async function create(options: CreateOptions = {}): Promise<CreateResult> {
  const { target, callbacks = {}, ...rest } = options;

  // Ensure target element
  if (target && !target.id) target.id = "root";

  const { runtime, files, idb } = await initSystem({ callbacks, ...rest });

  // Trigger first build
  await runtime.buildAndRun("create");

  return { runtime, files, idb };
}

// Register on window for script-tag usage
if (typeof window !== "undefined") {
  window.ctxl = { create, createRuntime, createAtomRegistry, createIDB, SEEDS };
}
