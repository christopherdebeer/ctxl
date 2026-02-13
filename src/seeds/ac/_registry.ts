/**
 * VFS SEED — imported as raw text, not compiled into the host bundle.
 *
 * This file is authored as normal TypeScript so it benefits from IDE
 * autocompletion and type-checking (via tsconfig.seeds.json), but at build
 * time Vite's `?raw` import injects its source text as a string into the
 * host bundle.  At runtime esbuild-wasm compiles it inside the browser as
 * part of the Virtual File System (VFS).
 *
 * VFS path:  /src/ac/_registry.ts
 * Registry:  src/seeds-v2.ts
 *
 * NOTE: This is the initial empty registry stub.  At runtime the host
 * calls runtime.regenerateRegistry() to rewrite this file in the VFS
 * with imports for every authored component.
 */

// Auto-generated component registry.
(window as any).__COMPONENTS__ ??= {};
