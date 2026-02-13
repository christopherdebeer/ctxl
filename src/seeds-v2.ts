/**
 * VFS seed files — AbstractComponent paradigm.
 *
 * Seeds provide the infrastructure layer in the VFS:
 * - ctxl/hooks.ts (useReasoning, useAtom)
 * - ctxl/abstract-component.tsx (the AC wrapper)
 * - main.tsx (entry point)
 * - ac/_registry.ts (component registry, initially empty)
 *
 * Seed source lives under src/seeds/ as normal TypeScript files (for IDE
 * support and type-checking) and is pulled in here as raw text via Vite's
 * `?raw` import suffix.  At runtime the VFS is populated with these strings
 * and esbuild-wasm compiles them inside the browser.
 *
 * Authored component source goes into /src/ac/{id}.tsx at runtime.
 */

import SEED_CTXL_HOOKS_SOURCE from "./seeds/ctxl/hooks.ts?raw";
import SEED_ABSTRACT_COMPONENT_SOURCE from "./seeds/ctxl/abstract-component.tsx?raw";
import SEED_REGISTRY_SOURCE from "./seeds/ac/_registry.ts?raw";
import SEED_V2_MAIN_SOURCE from "./seeds/main.tsx?raw";

export const SEEDS: Map<string, string> = new Map([
  ["/src/ctxl/hooks.ts", SEED_CTXL_HOOKS_SOURCE],
  ["/src/ctxl/abstract-component.tsx", SEED_ABSTRACT_COMPONENT_SOURCE],
  ["/src/ac/_registry.ts", SEED_REGISTRY_SOURCE],
  ["/src/main.tsx", SEED_V2_MAIN_SOURCE],
]);
