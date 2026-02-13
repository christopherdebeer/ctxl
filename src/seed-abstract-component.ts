/**
 * Seed: /src/ctxl/abstract-component.tsx — The AbstractComponent wrapper.
 *
 * Handles:
 * - Identity resolution (id -> VFS source)
 * - Authoring on first mount (LLM generates source)
 * - Re-authoring on shape change
 * - Error boundary with rollback
 * - Rendering the authored component with inputs/tools
 */

export const SEED_ABSTRACT_COMPONENT_SOURCE = `import React, { useState, useEffect, useRef, useCallback, Component } from "react";

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
  children: React.ReactNode;
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
      return React.createElement("div", {
        style: {
          padding: "20px", margin: "10px", border: "1px solid #c00",
          borderRadius: "8px", background: "#1a0000", color: "#f88",
          fontFamily: "monospace", fontSize: "13px",
        }
      },
        React.createElement("div", { style: { fontWeight: "bold", marginBottom: "8px" } },
          "Component error [" + this.props.componentId + "] (crash #" + crashCount + ")"
        ),
        React.createElement("pre", { style: { whiteSpace: "pre-wrap", color: "#faa", margin: "8px 0" } },
          error?.message || "Unknown error"
        ),
        crashCount >= 3
          ? React.createElement("div", { style: { color: "#fa0", marginBottom: "8px" } },
              "Multiple crashes detected. Attempting rollback to last known-good source..."
            )
          : null,
        React.createElement("button", {
          onClick: this.reset,
          style: {
            padding: "6px 16px", background: "#333", color: "#fff",
            border: "1px solid #666", borderRadius: "4px", cursor: "pointer",
          },
        }, "Retry"),
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
  guidelines,
  fallback,
  onToolCall,
}: {
  id: string;
  inputs?: Record<string, any>;
  tools?: Array<{ name: string; description: string; schema?: Record<string, string> }>;
  guidelines?: string;
  fallback?: React.ReactNode;
  onToolCall?: (name: string, args: any) => void;
}) {
  const [phase, setPhase] = useState<"checking" | "authoring" | "ready" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const authoringRef = useRef(false);
  const shapeRef = useRef({ inputs: getShape(inputs), tools: getToolShape(tools) });

  // Get the compiled component from the registry
  const registry = (window as any).__COMPONENTS__ || {};
  const CompiledComponent = registry[id] || null;

  // Check if shape changed (triggers re-authoring)
  const currentInputShape = getShape(inputs);
  const currentToolShape = getToolShape(tools);
  const shapeChanged =
    phase === "ready" &&
    (currentInputShape !== shapeRef.current.inputs || currentToolShape !== shapeRef.current.tools);

  // Author or re-author when needed
  useEffect(() => {
    if (authoringRef.current) return;

    // Already have the component and shape hasn't changed
    if (CompiledComponent && !shapeChanged) {
      shapeRef.current = { inputs: currentInputShape, tools: currentToolShape };
      setPhase("ready");
      return;
    }

    // Need to author (or re-author)
    const runtime = (window as any).__RUNTIME__;
    if (!runtime) {
      setPhase("error");
      setErrorMsg("No runtime available");
      return;
    }

    authoringRef.current = true;
    setPhase("authoring");

    // LLM calls can run in parallel, but buildAndRun must be serialised.
    // Split authoring into: (1) LLM call, (2) queued VFS write + rebuild.
    (async () => {
      try {
        const vfsPath = "/src/ac/" + id + ".tsx";
        const existingSource = runtime.files.get(vfsPath) || "";
        const isReauthor = shapeChanged && !!existingSource;

        // Call LLM to author the component (can run concurrently with other LLM calls)
        const system = runtime.buildAuthoringPrompt(id, inputs, tools, guidelines, isReauthor ? existingSource : undefined);
        const messages = [{ role: "user", content: "Author this component." }];
        const response = await runtime.callLLM(system, messages);

        if (response.error) {
          setPhase("error");
          setErrorMsg(response.error);
          authoringRef.current = false;
          return;
        }

        // Extract source from response
        let source = "";
        const data = response.data;
        if (data?.content) {
          const textBlock = data.content.find((b: any) => b.type === "text");
          source = textBlock?.text || "";
        }

        // Strip markdown fences if present
        const fenceMatch = source.match(/\`\`\`(?:tsx?|jsx?)?\\s*\\n([\\s\\S]*?)\`\`\`/);
        if (fenceMatch) source = fenceMatch[1];
        source = source.trim();

        if (!source) {
          setPhase("error");
          setErrorMsg("Authoring produced empty source");
          authoringRef.current = false;
          return;
        }

        // Serialise VFS write + rebuild to prevent concurrent builds
        await enqueueAuthoring(async () => {
          // Record mutation history (before overwriting)
          recordMutation({
            componentId: id,
            trigger: isReauthor ? "re-author:shape-change" : "author:first-mount",
            previousSource: existingSource,
            newSource: source,
            outcome: "swap",
          });

          // Write to VFS and rebuild
          runtime.files.set(vfsPath, source);
          await runtime.idb.put(vfsPath, source);

          // Update the component registry file
          runtime.regenerateRegistry();

          // Rebuild — after this, window.__COMPONENTS__[id] will exist
          await runtime.buildAndRun("author:" + id);
        });

        shapeRef.current = { inputs: currentInputShape, tools: currentToolShape };
        resetReshapeCounter(id);
        setPhase("ready");
      } catch (err: any) {
        setPhase("error");
        setErrorMsg(err.message || String(err));
      } finally {
        authoringRef.current = false;
      }
    })();
  }, [id, CompiledComponent, shapeChanged, currentInputShape, currentToolShape]);

  // Error boundary crash handler with rollback on repeated crashes
  const handleCrash = useCallback((error: Error, crashCount: number) => {
    console.error("[AC:" + id + "] Component crashed:", error.message);

    // After 3 consecutive crashes, attempt rollback to previous source
    if (crashCount >= 3) {
      const prev = getPreviousSource(id);
      if (prev) {
        const runtime = (window as any).__RUNTIME__;
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

  // Handle tool calls including __reshape
  const handleToolCall = useCallback((name: string, args: any) => {
    if (name === "__reshape") {
      trackReshape(id);
      // Record the reshape trigger before re-authoring
      const runtime = (window as any).__RUNTIME__;
      if (runtime) {
        const vfsPath = "/src/ac/" + id + ".tsx";
        const currentSource = runtime.files.get(vfsPath) || "";
        if (currentSource) {
          recordMutation({
            componentId: id,
            trigger: "reshape:" + (args?.reason || "self-requested"),
            previousSource: currentSource,
            newSource: "", // will be filled by re-authoring
            outcome: "swap",
          });
        }
      }
      // Trigger re-authoring
      shapeRef.current = { inputs: "", tools: "" }; // force shape mismatch
      setPhase("checking"); // will trigger re-author effect
      return;
    }
    if (onToolCall) onToolCall(name, args);
  }, [id, onToolCall]);

  // Render states
  if (phase === "error") {
    return React.createElement("div", {
      style: {
        padding: "20px", margin: "10px", border: "1px solid #c00",
        borderRadius: "8px", background: "#1a0000", color: "#f88",
        fontFamily: "monospace", fontSize: "13px",
      }
    },
      React.createElement("div", { style: { fontWeight: "bold", marginBottom: "8px" } },
        "Authoring failed [" + id + "]"
      ),
      React.createElement("pre", { style: { whiteSpace: "pre-wrap", color: "#faa" } }, errorMsg),
      React.createElement("button", {
        onClick: () => { setPhase("checking"); setErrorMsg(""); },
        style: {
          marginTop: "8px", padding: "6px 16px", background: "#333",
          color: "#fff", border: "1px solid #666", borderRadius: "4px", cursor: "pointer",
        },
      }, "Retry"),
    );
  }

  if (phase === "authoring" || phase === "checking" || !CompiledComponent) {
    return (fallback || React.createElement("div", {
      style: {
        padding: "40px", textAlign: "center", color: "#888",
        fontFamily: "system-ui", fontSize: "14px",
      }
    },
      React.createElement("div", {
        style: {
          display: "inline-block", width: "20px", height: "20px",
          border: "2px solid #444", borderTopColor: "#888",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
        }
      }),
      React.createElement("div", { style: { marginTop: "12px" } },
        phase === "authoring" ? "Authoring " + id + "..." : "Loading..."
      ),
      React.createElement("style", {},
        "@keyframes spin { to { transform: rotate(360deg); } }"
      ),
    ));
  }

  // Render the authored component
  return React.createElement(ComponentErrorBoundary, {
    componentId: id,
    onCrash: handleCrash,
  },
    React.createElement(CompiledComponent, {
      inputs,
      tools,
      onToolCall: handleToolCall,
    }),
  );
}
`;
