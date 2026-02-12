// Ambient module declarations for CDN-loaded externals.
// This file must NOT have top-level import/export to remain a script (not a module).

declare module "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js" {
  export function initialize(options: {
    wasmURL: string;
    worker: boolean;
  }): Promise<void>;
  export function build(
    options: Record<string, unknown>,
  ): Promise<{ outputFiles?: Array<{ text: string }> }>;
}

declare module "react-refresh/runtime" {
  export function injectIntoGlobalHook(window: Window): void;
  export function register(type: any, id: string): void;
  export function createSignatureFunctionForTransform(): (type: any) => any;
  export function performReactRefresh(): void;
}
