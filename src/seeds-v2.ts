/**
 * VFS seed files — AbstractComponent paradigm.
 *
 * Seeds provide the infrastructure layer in the VFS:
 * - ctxl/hooks.ts (useReasoning, useAtom)
 * - ctxl/abstract-component.tsx (the AC wrapper)
 * - main.tsx (entry point)
 * - ac/_registry.ts (component registry, initially empty)
 *
 * Authored component source goes into /src/ac/{id}.tsx at runtime.
 */

import { SEED_CTXL_HOOKS_SOURCE } from "./seed-ctxl-hooks";
import { SEED_ABSTRACT_COMPONENT_SOURCE } from "./seed-abstract-component";
import { SEED_V2_MAIN_SOURCE } from "./seed-v2-main";

/** Empty registry — gets regenerated when components are authored. */
const SEED_REGISTRY_SOURCE = `// Auto-generated component registry.
(window as any).__COMPONENTS__ ??= {};
`;

export const SEEDS: Map<string, string> = new Map([
  ["/src/ctxl/hooks.ts", SEED_CTXL_HOOKS_SOURCE],
  ["/src/ctxl/abstract-component.tsx", SEED_ABSTRACT_COMPONENT_SOURCE],
  ["/src/ac/_registry.ts", SEED_REGISTRY_SOURCE],
  ["/src/main.tsx", SEED_V2_MAIN_SOURCE],
]);
