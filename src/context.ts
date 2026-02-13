/**
 * CtxlProvider — Host-bundle React provider for library consumers.
 *
 * Wraps an existing React app so that <AbstractComponent>, useAtom, and
 * useReasoning work inside the tree without globals.
 *
 * Usage:
 *   import { CtxlProvider } from "ctxl";
 *
 *   function App() {
 *     return (
 *       <CtxlProvider apiMode="proxy" proxyUrl="/api/chat">
 *         <AbstractComponent id="chat" inputs={{ topic: "React" }} />
 *       </CtxlProvider>
 *     );
 *   }
 *
 * The provider handles the full async boot sequence (esbuild-wasm, IDB,
 * atom registry, runtime) via the shared initSystem() function — the same
 * code path that the dev environment's boot.ts uses.
 */
import React, { useEffect, useState, useRef, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { initSystem } from "./init";
import type { InitSystemResult, InitSystemOptions } from "./init";
import type { RuntimeCallbacks, ApiMode } from "./types";

// ---- Context (host-side mirror of the VFS RuntimeContext) ----

export type RuntimeContextValue = InitSystemResult;

/**
 * The context object.  In VFS-compiled code the identical shape is defined
 * in hooks.ts; both point at the same React.createContext instance when the
 * import-map shares a single React, so provider/consumer pairing works
 * across the host - blob-ESM boundary.
 *
 * For the host bundle we define our own createContext — the VFS side falls
 * back to globals when no provider is found, so there is no mismatch.
 */
export const HostRuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useCtxlRuntime(): RuntimeContextValue {
  const ctx = useContext(HostRuntimeContext);
  if (!ctx) throw new Error("useCtxlRuntime must be used within <CtxlProvider>");
  return ctx;
}

// ---- Provider props ----

export interface CtxlProviderProps {
  children: ReactNode;
  /** How the LLM is reached: "none" | "anthropic" | "proxy" */
  apiMode?: ApiMode;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  /** URL for the esbuild-wasm ESM loader */
  esbuildUrl?: string;
  /** URL for the esbuild .wasm binary */
  esbuildWasmUrl?: string;
  /** IndexedDB database name */
  dbName?: string;
  /** Override the default VFS seed files */
  seeds?: Map<string, string>;
  /** Runtime lifecycle callbacks (status, build, errors) */
  callbacks?: RuntimeCallbacks;
  /** Rendered while the system is booting */
  fallback?: ReactNode;
  /**
   * If provided, the runtime + atoms are also written to window globals
   * for backward compatibility (window.__RUNTIME__, window.__ATOMS__).
   * Defaults to true.
   */
  exposeGlobals?: boolean;
}

// ---- Provider ----

export function CtxlProvider({
  children,
  apiMode,
  apiKey,
  proxyUrl,
  model,
  esbuildUrl,
  esbuildWasmUrl,
  dbName,
  seeds,
  callbacks,
  fallback,
  exposeGlobals,
}: CtxlProviderProps) {
  const [ctx, setCtx] = useState<RuntimeContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bootedRef = useRef(false);

  // Stable reference to callbacks
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    initSystem({
      apiMode,
      apiKey,
      proxyUrl,
      model,
      esbuildUrl,
      esbuildWasmUrl,
      dbName,
      seeds,
      callbacks: cbRef.current,
      exposeGlobals,
    })
      .then(setCtx)
      .catch((err: any) => {
        console.error("[CtxlProvider] Boot failed:", err);
        setError(err.message || String(err));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return React.createElement("div", {
      style: { padding: 20, color: "#c00", fontFamily: "monospace" },
    }, "ctxl boot error: " + error);
  }

  if (!ctx) {
    return (fallback ?? null) as React.ReactElement | null;
  }

  return React.createElement(HostRuntimeContext.Provider, { value: ctx }, children);
}
