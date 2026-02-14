/**
 * VFS SEED — imported as raw text, not compiled into the host bundle.
 *
 * This file is authored as normal TypeScript so it benefits from IDE
 * autocompletion and type-checking (via tsconfig.seeds.json), but at build
 * time Vite's `?raw` import injects its source text as a string into the
 * host bundle.  At runtime esbuild-wasm compiles it inside the browser as
 * part of the Virtual File System (VFS).
 *
 * VFS path:  /src/ctxl/abstract-component.tsx
 * Registry:  src/seeds-v2.ts
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { ToolContext, useRuntimeContext } from "./hooks";

// ---- Mutation History ----

interface MutationEntry {
  id: string;
  timestamp: number;
  componentId: string;
  trigger: string;
  previousSource: string;
  newSource: string;
  outcome: "swap" | "remount" | "crash-recovery" | "rollback";
}

function getMutationHistory(): MutationEntry[] {
  const w = window as any;
  if (!w.__MUTATIONS__) w.__MUTATIONS__ = [];
  return w.__MUTATIONS__;
}

function recordMutation(entry: Omit<MutationEntry, "id" | "timestamp">): void {
  const history = getMutationHistory();
  history.push({
    ...entry,
    id: Math.random().toString(36).slice(2, 10),
    timestamp: Date.now(),
  });
  // Keep at most 50 entries to avoid unbounded growth
  if (history.length > 50) history.splice(0, history.length - 50);
}

function getPreviousSource(componentId: string): string | null {
  const history = getMutationHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].componentId === componentId && history[i].previousSource) {
      return history[i].previousSource;
    }
  }
  return null;
}

// ---- Authoring Queue ----
// Serialises authoring + buildAndRun to prevent concurrent builds.

let authoringQueue: Promise<void> = Promise.resolve();

function enqueueAuthoring(fn: () => Promise<void>): Promise<void> {
  authoringQueue = authoringQueue.then(fn, fn);
  return authoringQueue;
}

// ---- Error Boundary ----

interface EBProps {
  componentId: string;
  children?: ReactNode;
  onCrash: (error: Error, crashCount: number) => void;
}

interface EBState {
  hasError: boolean;
  error: Error | null;
  crashCount: number;
  rollingBack: boolean;
}

class ComponentErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: null, crashCount: 0, rollingBack: false };

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    const next = this.state.crashCount + 1;
    this.setState({ crashCount: next });
    console.error("[AC:" + this.props.componentId + "] Crash #" + next, error);
    this.props.onCrash(error, next);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { error, crashCount } = this.state;
      return (
        <div style={{
          padding: "20px", margin: "10px", border: "1px solid #c00",
          borderRadius: "8px", background: "#1a0000", color: "#f88",
          fontFamily: "monospace", fontSize: "13px",
        }}>
          <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
            Component error [{this.props.componentId}] (crash #{crashCount})
          </div>
          <pre style={{ whiteSpace: "pre-wrap", color: "#faa", margin: "8px 0" }}>
            {error?.message || "Unknown error"}
          </pre>
          {crashCount >= 3 && (
            <div style={{ color: "#fa0", marginBottom: "8px" }}>
              Multiple crashes detected. Attempting rollback to last known-good source...
            </div>
          )}
          <button
            onClick={this.reset}
            style={{
              padding: "6px 16px", background: "#333", color: "#fff",
              border: "1px solid #666", borderRadius: "4px", cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---- Shape comparison ----
// Tracks key names + value types for precise structural change detection.

function getShape(obj: Record<string, any> | undefined): string {
  if (!obj) return "";
  return Object.keys(obj).sort().map(k => {
    const v = obj[k];
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    return k + ":" + t;
  }).join(",");
}

function getToolShape(tools: any[] | undefined): string {
  if (!tools) return "";
  return tools.map((t: any) => {
    const sk = t.schema ? Object.keys(t.schema).sort().join("+") : "";
    return t.name + (sk ? "(" + sk + ")" : "");
  }).sort().join(",");
}

function getHandlerShape(handlers: Record<string, any> | undefined): string {
  if (!handlers) return "";
  return Object.keys(handlers).sort().join(",");
}

// ---- Freshness tracking ----
// Tracks reshape requests per component to detect stale authoring.

const reshapeCounters: Record<string, { count: number; since: number }> = {};

function trackReshape(componentId: string): void {
  const entry = reshapeCounters[componentId] ||= { count: 0, since: Date.now() };
  entry.count++;
  if (entry.count >= 3) {
    console.warn("[AC:" + componentId + "] Frequent reshape requests (" + entry.count + " since last authoring). Consider revising guidelines.");
  }
}

function resetReshapeCounter(componentId: string): void {
  reshapeCounters[componentId] = { count: 0, since: Date.now() };
}

// ---- AbstractComponent ----

export function AbstractComponent({
  id,
  inputs = {},
  tools = [],
  handlers = {},
  guidelines,
  fallback,
}: {
  id: string;
  inputs?: Record<string, any>;
  tools?: Array<{ name: string; description: string; schema?: Record<string, string>; handler: (args: any) => any }>;
  handlers?: Record<string, { description: string; fn: (...args: any[]) => any }>;
  guidelines?: string;
  fallback?: ReactNode;
}) {
  const { runtime: ctxRuntime } = useRuntimeContext();

  const [phase, setPhase] = useState<"checking" | "authoring" | "ready" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [reshapeVersion, setReshapeVersion] = useState(0);
  const authoringRef = useRef(false);
  const shapeRef = useRef({ inputs: getShape(inputs), tools: getToolShape(tools), handlers: getHandlerShape(handlers) });

  // Get the compiled component from the registry
  const registry = (window as any).__COMPONENTS__ || {};
  const compiledComponent = registry[id] || null;

  // Check if shape changed (triggers re-authoring)
  const currentInputShape = getShape(inputs);
  const currentToolShape = getToolShape(tools);
  const currentHandlerShape = getHandlerShape(handlers);
  const shapeChanged =
    phase === "ready" &&
    (currentInputShape !== shapeRef.current.inputs ||
     currentToolShape !== shapeRef.current.tools ||
     currentHandlerShape !== shapeRef.current.handlers);

  // ---- Tool Context: parent tools injected into useReasoning via context ----

  // Strip handlers to get tool definitions for the LLM prompt
  const toolDefsKey = getToolShape(tools);
  const toolDefs = useMemo(() =>
    tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
    [toolDefsKey]
  );

  // Stable dispatch via ref so context value doesn't churn
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const dispatch = useCallback((name: string, args: any): any => {
    const tool = toolsRef.current.find(t => t.name === name);
    if (tool?.handler) return tool.handler(args);
    console.warn("[AC:" + id + "] No handler for tool: " + name);
    return undefined;
  }, [id]);

  const reshape = useCallback((reason: string) => {
    trackReshape(id);
    const runtime = ctxRuntime;
    if (runtime) {
      const vfsPath = "/src/ac/" + id + ".tsx";
      const currentSource = runtime.files.get(vfsPath) || "";
      if (currentSource) {
        recordMutation({
          componentId: id,
          trigger: "reshape:" + reason,
          previousSource: currentSource,
          newSource: "",
          outcome: "swap",
        });
      }
    }
    // Bump version to force the authoring effect to re-fire.
    // shapeRef reset ensures isReauthor detects existing source.
    shapeRef.current = { inputs: "", tools: "", handlers: "" };
    setReshapeVersion(v => v + 1);
    setPhase("checking");
  }, [id]);

  const toolCtxValue = useMemo(() => ({
    tools: toolDefs,
    dispatch,
    reshape,
    componentId: id,
  }), [toolDefs, dispatch, reshape, id]);

  // ---- Strip handler descriptions for child (just the functions) ----

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handlerFns = useMemo(() => {
    const result: Record<string, (...args: any[]) => any> = {};
    for (const k of Object.keys(handlers)) {
      // Stable wrappers that read from ref
      result[k] = (...args: any[]) => handlersRef.current[k]?.fn(...args);
    }
    return result;
  }, [getHandlerShape(handlers)]);

  // ---- Author or re-author when needed ----

  useEffect(() => {
    if (authoringRef.current) return;

    // Reshape request: phase is "checking", reshapeVersion > 0 (not initial mount),
    // and we already have a compiled component → reshape() was called.
    const reshapeRequested = phase === "checking" && reshapeVersion > 0 && !!compiledComponent;

    // Already have the component, no shape change, and no reshape request
    if (compiledComponent && !shapeChanged && !reshapeRequested) {
      shapeRef.current = { inputs: currentInputShape, tools: currentToolShape, handlers: currentHandlerShape };
      setPhase("ready");
      return;
    }

    // Need to author (or re-author)
    const runtime = ctxRuntime;
    if (!runtime) {
      setPhase("error");
      setErrorMsg("No runtime available");
      return;
    }

    authoringRef.current = true;
    setPhase("authoring");

    // LLM calls can run in parallel, but buildAndRun must be serialised.
    (async () => {
      try {
        const vfsPath = "/src/ac/" + id + ".tsx";
        const existingSource = runtime.files.get(vfsPath) || "";
        const isReauthor = (shapeChanged || reshapeRequested) && !!existingSource;

        // Build handler descriptions for the authoring prompt
        const handlerDescs: Record<string, string> = {};
        for (const [k, v] of Object.entries(handlers)) {
          handlerDescs[k] = v.description;
        }

        // Call LLM to author the component via write_component tool
        const system = runtime.buildAuthoringPrompt(id, inputs, toolDefs, handlerDescs, guidelines, isReauthor ? existingSource : undefined);
        const messages = [{ role: "user", content: "Author this component." }];
        const authorTool = {
          name: "write_component",
          description: "Write the complete component source code",
          input_schema: {
            type: "object",
            properties: {
              src: { type: "string", description: "Complete TSX source code for the component" },
            },
            required: ["src"],
          },
        };
        const response = await runtime.callLLM(system, messages, {
          tools: [authorTool],
          tool_choice: { type: "tool", name: "write_component" },
          _source: "author:" + id,
        });

        if (response.error) {
          setPhase("error");
          setErrorMsg(response.error);
          authoringRef.current = false;
          return;
        }

        // Extract source from write_component tool_use block
        const data = response.data;
        const toolBlock = data?.content?.find(
          (b: any) => b.type === "tool_use" && b.name === "write_component"
        );
        let source = (toolBlock?.input?.src || "").trim();

        if (!source) {
          setPhase("error");
          setErrorMsg("Authoring produced empty source");
          authoringRef.current = false;
          return;
        }

        // Serialise VFS write + rebuild to prevent concurrent builds
        await enqueueAuthoring(async () => {
          recordMutation({
            componentId: id,
            trigger: isReauthor ? "re-author:shape-change" : "author:first-mount",
            previousSource: existingSource,
            newSource: source,
            outcome: "swap",
          });

          runtime.files.set(vfsPath, source);
          await runtime.idb.put(vfsPath, source);
          runtime.regenerateRegistry();
          await runtime.buildAndRun("author:" + id);
        });

        shapeRef.current = { inputs: currentInputShape, tools: currentToolShape, handlers: currentHandlerShape };
        resetReshapeCounter(id);
        setPhase("ready");
      } catch (err: any) {
        setPhase("error");
        setErrorMsg(err.message || String(err));
      } finally {
        authoringRef.current = false;
      }
    })();
  }, [id, ctxRuntime, compiledComponent, shapeChanged, reshapeVersion, phase, currentInputShape, currentToolShape, currentHandlerShape]);

  // Error boundary crash handler with rollback on repeated crashes
  const handleCrash = useCallback((error: Error, crashCount: number) => {
    console.error("[AC:" + id + "] Component crashed:", error.message);

    if (crashCount >= 3) {
      const prev = getPreviousSource(id);
      if (prev) {
        const runtime = ctxRuntime;
        if (runtime) {
          const vfsPath = "/src/ac/" + id + ".tsx";
          const currentSource = runtime.files.get(vfsPath) || "";

          console.warn("[AC:" + id + "] Rolling back to previous source after " + crashCount + " crashes");

          recordMutation({
            componentId: id,
            trigger: "rollback:crash-count-" + crashCount,
            previousSource: currentSource,
            newSource: prev,
            outcome: "rollback",
          });

          runtime.files.set(vfsPath, prev);
          runtime.idb.put(vfsPath, prev).catch(() => {});
          runtime.regenerateRegistry();
          runtime.buildAndRun("rollback:" + id).catch((e: any) => {
            console.error("[AC:" + id + "] Rollback build failed:", e);
          });
        }
      } else {
        console.warn("[AC:" + id + "] No previous source available for rollback");
      }
    }
  }, [id]);

  // Render states
  if (phase === "error") {
    return (
      <div style={{
        padding: "20px", margin: "10px", border: "1px solid #c00",
        borderRadius: "8px", background: "#1a0000", color: "#f88",
        fontFamily: "monospace", fontSize: "13px",
      }}>
        <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
          Authoring failed [{id}]
        </div>
        <pre style={{ whiteSpace: "pre-wrap", color: "#faa" }}>{errorMsg}</pre>
        <button
          onClick={() => { setPhase("checking"); setErrorMsg(""); }}
          style={{
            marginTop: "8px", padding: "6px 16px", background: "#333",
            color: "#fff", border: "1px solid #666", borderRadius: "4px", cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (phase === "authoring" || phase === "checking" || !compiledComponent) {
    return fallback || (
      <div style={{
        padding: "40px", textAlign: "center", color: "#888",
        fontFamily: "system-ui", fontSize: "14px",
      }}>
        <div style={{
          display: "inline-block", width: "20px", height: "20px",
          border: "2px solid #444", borderTopColor: "#888",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
        }} />
        <div style={{ marginTop: "12px" }}>
          {phase === "authoring" ? "Authoring " + id + "..." : "Loading..."}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Render the authored component wrapped in ToolContext
  return (
    <ComponentErrorBoundary componentId={id} onCrash={handleCrash}>
      <ToolContext.Provider value={toolCtxValue}>
        {React.createElement(compiledComponent, { inputs, handlers: handlerFns })}
      </ToolContext.Provider>
    </ComponentErrorBoundary>
  );
}
