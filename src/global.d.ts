import type { Runtime } from "./types";

declare global {
  interface Window {
    __RUNTIME__: Runtime;
    ctxl: Record<string, unknown>;
    $RefreshReg$: (...args: any[]) => void;
    $RefreshSig$: (...args: any[]) => (type: any) => any;
  }

  // CDN-loaded globals (script tags in index.html)
  const marked: { parse(md: string): string };
  const eruda: { init(): void };
}

export {};
