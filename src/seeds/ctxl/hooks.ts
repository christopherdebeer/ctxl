/**
 * VFS SEED — imported as raw text, not compiled into the host bundle.
 *
 * This file is authored as normal TypeScript so it benefits from IDE
 * autocompletion and type-checking (via tsconfig.seeds.json), but at build
 * time Vite's `?raw` import injects its source text as a string into the
 * host bundle.  At runtime esbuild-wasm compiles it inside the browser as
 * part of the Virtual File System (VFS).
 *
 * VFS path:  /src/ctxl/hooks.ts
 * Registry:  src/seeds-v2.ts
 */

import { useState, useEffect, useRef, useCallback, useSyncExternalStore, createContext, useContext } from "react";

// ---- Types ----

interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, string>;
  handler?: (args: any) => any;
}

interface UseReasoningOptions<T = { content: string }> {
  /** JSON Schema for the respond tool — defines the shape the agent must produce. */
  responseSchema?: Record<string, any>;
  tools?: ToolDef[];
  onToolCall?: (name: string, args: any) => any;
  debounceMs?: number;
  componentId?: string;
  maxTurns?: number;
  /** Keep previous response visible while new reasoning runs (avoids flash to null). */
  keepStale?: boolean;
  /** Debounce timing shorthand: "eager" (0ms), "normal" (300ms), "background" (1000ms). */
  priority?: "eager" | "normal" | "background";
}

interface UseReasoningReturn<T = { content: string }> {
  status: "idle" | "reasoning" | "done" | "error";
  response: T | null;
  error: string | null;
  turn: number;
  maxTurns: number;
  statusText: string | null;
  /** True when showing a previous response while new reasoning is in progress. */
  stale: boolean;
}

// ---- Runtime Context ----
// Provides runtime + atoms via React Context so that library consumers
// can wrap their existing React tree in <RuntimeProvider> and have
// AbstractComponent, useAtom, and useReasoning work without globals.

interface RuntimeContextValue {
  runtime: any;
  atoms: any;
}

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);

/**
 * Read runtime + atoms from React Context, falling back to window globals.
 * This allows VFS code to work both inside a <RuntimeProvider> tree
 * and in the legacy globals-only boot path.
 */
export function useRuntimeContext(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  return ctx || {
    runtime: (window as any).__RUNTIME__,
    atoms: (window as any).__ATOMS__,
  };
}

// ---- Tool Context ----
// Parent-provided tools are injected via React Context by AbstractComponent.
// useReasoning reads from this context automatically — child components
// never need to thread tools/onToolCall through props.

interface ToolContextValue {
  tools: ToolDef[];
  dispatch: (name: string, args: any) => any;
  reshape: (reason: string) => void;
  componentId: string;
}

export const ToolContext = createContext<ToolContextValue | null>(null);

// ---- Build system context from tools ----

function buildSystemContext(
  tools: ToolDef[],
  componentId?: string,
  runtimeCtx?: RuntimeContextValue | null,
  responseSchema?: Record<string, any>,
): string {
  const id = componentId || "anonymous";

  // Tool descriptions (text context for the LLM alongside real API tools)
  const toolLines = tools.map(function(t) {
    let line = "- " + t.name + ": " + t.description;
    if (t.schema) {
      const fields = Object.entries(t.schema).map(function(e) { return e[0] + ": " + e[1]; }).join(", ");
      line += " (args: { " + fields + " })";
    }
    return line;
  });

  // Built-in tools always available
  if (responseSchema && responseSchema.properties) {
    const fields = Object.keys(responseSchema.properties).join(", ");
    toolLines.push("- respond: Provide your response to the component (fields: " + fields + ")");
  } else {
    toolLines.push("- respond: Provide your response to the component (args: { content: string })");
  }
  toolLines.push("- __reshape: Rewrite your own source code (args: { reason: string }). TERMINAL — your component will be replaced.");
  toolLines.push("- read_atom: Read the full value of a shared state atom (args: { key: string })");
  toolLines.push("- write_atom: Write a value to a shared state atom (args: { key: string, value: any })");
  toolLines.push("- read_component_source: Read source code of any authored component (args: { id: string })");
  toolLines.push("- list_components: List all authored component IDs");
  toolLines.push("- list_atoms: List all shared state atom keys with value summaries");

  // Component source for self-awareness
  let sourceBlock = "";
  try {
    const runtime = runtimeCtx?.runtime;
    if (runtime?.files) {
      const source = runtime.files.get("/src/ac/" + id + ".tsx");
      if (source && source.length < 4000) {
        sourceBlock = "\n\nYOUR CURRENT SOURCE:\n" + source;
      } else if (source) {
        sourceBlock = "\n\nYOUR CURRENT SOURCE: (" + source.length + " chars, truncated)\n" + source.slice(0, 3000) + "\n...(truncated)";
      }
    }
  } catch {}

  // Inspection context: atom state + sibling components (summaries for awareness)
  let inspectionBlock = "";
  try {
    const atoms = runtimeCtx?.atoms || (window as any).__ATOMS__;
    if (atoms && typeof atoms.keys === "function") {
      const atomKeys = atoms.keys();
      if (atomKeys.length > 0) {
        const atomSummary = atomKeys.map(function(k: string) {
          try {
            const v = atoms.get(k)?.get();
            const s = JSON.stringify(v);
            return "  " + k + ": " + (s && s.length > 80 ? s.slice(0, 80) + "..." : s);
          } catch { return "  " + k + ": <unreadable>"; }
        }).join("\n");
        inspectionBlock += "\n\nSHARED STATE (atoms):\n" + atomSummary;
      }
    }
    const components = (window as any).__COMPONENTS__;
    if (components) {
      const siblings = Object.keys(components).filter(function(k) { return k !== id; });
      if (siblings.length > 0) {
        inspectionBlock += "\n\nSIBLING COMPONENTS: " + siblings.join(", ");
      }
    }
  } catch {}

  // Engagement context — continuous evaluation signals from user interaction
  let engagementBlock = "";
  try {
    const engagement = (window as any).__ENGAGEMENT__;
    if (engagement && engagement[id]) {
      const m = engagement[id];
      const activeSections = Object.entries(m.sectionHits || {})
        .filter(function(e) { return (e[1] as number) > 0; })
        .sort(function(a, b) { return (b[1] as number) - (a[1] as number); })
        .slice(0, 5);
      const sectionStr = activeSections.length > 0
        ? activeSections.map(function(e) { return e[0] + ": " + e[1] + " interactions"; }).join(", ")
        : "none tracked";
      const idleMs = m.lastInteraction > 0 ? Date.now() - m.lastInteraction : -1;
      engagementBlock = "\n\nUSER ENGAGEMENT (continuous evaluation):" +
        "\n  Interactions: " + m.interactions +
        "\n  User overrides: " + m.overrides +
        "\n  Dwell time: " + Math.round((m.dwellTimeMs || 0) / 1000) + "s" +
        "\n  Active sections: " + sectionStr +
        (idleMs > 0 ? "\n  Idle for: " + Math.round(idleMs / 1000) + "s" : "");
    }
  } catch {}

  // Pinned state — values explicitly set by the user that should not be overridden
  let pinnedBlock = "";
  try {
    const pinned = (window as any).__PINNED__;
    if (pinned && pinned[id]) {
      const entries = Object.entries(pinned[id]);
      if (entries.length > 0) {
        const pinnedStr = entries.map(function(e) {
          var val = (e[1] as any).value;
          return "  " + e[0] + ": " + JSON.stringify(val);
        }).join("\n");
        pinnedBlock = "\n\nPINNED STATE (user-controlled — do NOT override these values):\n" + pinnedStr;
      }
    }
  } catch {}

  return "You are a React component (" + id + ") reasoning about a change in your inputs. Your render output is your body — your expression to the world. You reason about input changes and take action through tools." +
    sourceBlock +
    "\n\nAVAILABLE TOOLS:\n" + toolLines.join("\n") +
    inspectionBlock +
    engagementBlock +
    pinnedBlock +
    "\n\nINSTRUCTIONS:" +
    "\n- Examine the input values and reason about what changed and what action to take." +
    "\n- Call respond to provide your output to the component. You can call respond alongside other tools in the same turn." +
    "\n- Use introspection tools (read_atom, list_components, etc.) to investigate your environment on demand." +
    "\n- __reshape is TERMINAL — it replaces your source code entirely. Only use when your current implementation is fundamentally insufficient." +
    "\n- The reasoning loop ends when you stop calling tools. You do not need a special signal to finish — simply produce a text-only response when done." +
    "\n- Be concise. Prefer action over inaction — child AbstractComponents can handle sub-problems." +
    "\n- If PINNED STATE is shown, those values were explicitly set by the user. Respect them — do not override unless the user requests a change." +
    "\n- If USER ENGAGEMENT shows low interaction or high overrides, consider whether your output is serving the user well. Adapt accordingly.";
}

// ---- useReasoning ----

/**
 * Delta-driven LLM reasoning hook.
 *
 * Fires when deps change (like useEffect). Sends the prompt + delta to the LLM
 * with scoped tools. Returns a rich status object that the component can use to
 * render loading states, errors, and typed responses.
 *
 * Usage:
 *   const { status, response, statusText } = useReasoning<MyData>(
 *     "Analyze this data", [data], {
 *       responseSchema: { type: "object", properties: { ... }, required: [...] },
 *       tools,
 *     }
 *   );
 *
 *   if (status === "reasoning") return <Spinner label={statusText} />;
 *   if (response) return <MyUI data={response} />;
 */
export function useReasoning<T = { content: string }>(
  prompt: string | ((prev: any[], next: any[]) => string),
  deps: any[],
  options: UseReasoningOptions<T> = {},
): UseReasoningReturn<T> {
  const resolvedMaxTurns = options.maxTurns ?? 3;
  const [state, setState] = useState<UseReasoningReturn<T>>({
    status: "idle",
    response: null,
    error: null,
    turn: 0,
    maxTurns: resolvedMaxTurns,
    statusText: null,
    stale: false,
  });
  const prevDepsRef = useRef<any[] | null>(null);
  const fireCountRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Runtime from context (falls back to globals)
  const { runtime: ctxRuntime } = useRuntimeContext();

  // Parent tool context (provided by AbstractComponent)
  const parentCtx = useContext(ToolContext);
  const parentCtxRef = useRef(parentCtx);
  parentCtxRef.current = parentCtx;

  // Stable reference to options
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Helper: update state if still mounted
  const update = useCallback((patch: Partial<UseReasoningReturn<T>>) => {
    if (mountedRef.current) {
      setState(function(prev) { return { ...prev, ...patch } as UseReasoningReturn<T>; });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const prevDeps = prevDepsRef.current;
    prevDepsRef.current = deps;

    // Max fire count per mount to prevent runaway
    if (fireCountRef.current >= 10) {
      console.warn("[useReasoning] Max fire count reached, stopping");
      return;
    }

    const doReason = async () => {
      const runtime = ctxRuntime;
      if (!runtime) return;

      const resolvedPrompt = typeof prompt === "function"
        ? prompt(prevDeps || [], deps)
        : prompt;

      if (!resolvedPrompt) return;

      fireCountRef.current++;

      const { tools: localTools = [], onToolCall: localOnToolCall, componentId: optComponentId, maxTurns = 3, responseSchema, keepStale } = optionsRef.current;

      // When keepStale is true, preserve the previous response (marked stale) instead of flashing to null
      if (keepStale && state.response) {
        update({ status: "reasoning", error: null, turn: 0, maxTurns, statusText: "Thinking...", stale: true });
      } else {
        update({ status: "reasoning", response: null, error: null, turn: 0, maxTurns, statusText: "Thinking...", stale: false });
      }

      try {
        const config = runtime.config;
        if (config.apiMode === "none") {
          update({ status: "error", error: "No API configured.", statusText: null });
          return;
        }

        // Merge parent tools (from context) with component-local tools
        const ctx = parentCtxRef.current;
        const parentTools = ctx?.tools ?? [];
        const allTools = [...parentTools, ...localTools];
        const componentId = optComponentId || ctx?.componentId;

        // Track the latest response from the respond tool (last call wins)
        let latestResponse: T | null = null;

        // Unified dispatch: routes to builtin → parent → local → onToolCall
        const dispatchTool = (name: string, args: any): any => {
          const logDispatch = (route: string, result: any) => {
            const w = window as any;
            if (!w.__LOG__) w.__LOG__ = [];
            w.__LOG__.push({
              id: Math.random().toString(36).slice(2, 10),
              timestamp: Date.now(),
              source: "dispatch:" + (componentId || "anonymous"),
              system: "", messages: [], model: "",
              response: { tool: name, args, route, result },
            });
          };
          // __reshape always goes to context — TERMINAL
          if (name === "__reshape") {
            if (ctx?.reshape) { ctx.reshape(args?.reason || "self-requested"); logDispatch("reshape", "triggered"); return "reshape triggered"; }
            logDispatch("reshape", "no context");
            return undefined;
          }
          // Built-in introspection tools — always available
          if (name === "read_atom") {
            const atoms = (window as any).__ATOMS__;
            if (!atoms) { logDispatch("builtin", "No atom registry"); return "No atom registry available"; }
            const atom = atoms.get(args?.key);
            if (!atom) { logDispatch("builtin", "not found"); return "Atom not found: " + args?.key; }
            try { const v = JSON.stringify(atom.get(), null, 2); logDispatch("builtin", v); return v; }
            catch { logDispatch("builtin", "<unreadable>"); return "<unreadable>"; }
          }
          if (name === "write_atom") {
            const atoms = (window as any).__ATOMS__;
            if (!atoms) { logDispatch("builtin", "No atom registry"); return "No atom registry available"; }
            const atom = atoms.create(args?.key, undefined);
            try {
              atom.set(args?.value);
              logDispatch("builtin", "written");
              return "Atom '" + args?.key + "' updated";
            } catch (e: any) { logDispatch("builtin", "error: " + e.message); return "Error writing atom: " + e.message; }
          }
          if (name === "read_component_source") {
            const cid = args?.id || "";
            const source = runtime.files.get("/src/ac/" + cid + ".tsx");
            const result = source || "No source found for component: " + cid;
            logDispatch("builtin", source ? source.length + " chars" : "not found");
            return result;
          }
          if (name === "list_components") {
            const comps = (window as any).__COMPONENTS__ || {};
            const ids = Object.keys(comps);
            const result = ids.length > 0 ? ids.join(", ") : "No authored components";
            logDispatch("builtin", result);
            return result;
          }
          if (name === "list_atoms") {
            const atoms = (window as any).__ATOMS__;
            if (!atoms || typeof atoms.keys !== "function") { logDispatch("builtin", "no registry"); return "No atom registry available"; }
            const keys: string[] = atoms.keys();
            if (keys.length === 0) { logDispatch("builtin", "empty"); return "No atoms"; }
            const result = keys.map(function(k: string) {
              try {
                const v = atoms.get(k)?.get();
                const s = JSON.stringify(v);
                return k + ": " + (s && s.length > 120 ? s.slice(0, 120) + "..." : s);
              } catch { return k + ": <unreadable>"; }
            }).join("\n");
            logDispatch("builtin", keys.length + " atoms");
            return result;
          }
          // Parent tool — dispatch via context
          if (ctx && parentTools.some((t: any) => t.name === name)) {
            const result = ctx.dispatch(name, args);
            logDispatch("parent", result);
            return result;
          }
          // Local tool with inline handler
          const localTool = localTools.find((t: any) => t.name === name);
          if (localTool && typeof localTool.handler === "function") {
            const result = localTool.handler(args);
            logDispatch("local", result);
            return result;
          }
          // Fallback to onToolCall
          if (localOnToolCall) {
            const result = localOnToolCall(name, args);
            logDispatch("onToolCall", result);
            return result;
          }
          logDispatch("unhandled", undefined);
          console.warn("[useReasoning] No handler for tool: " + name);
          return undefined;
        };

        // respond tool — non-terminal. Schema from responseSchema option,
        // or default to { content: string }.
        const respondTool = {
          name: "respond",
          description: "Provide your response to the component. Call this when you have determined what the component needs. You can call other tools in the same turn.",
          input_schema: responseSchema || {
            type: "object" as const,
            properties: {
              content: { type: "string", description: "Your response text" },
            },
            required: ["content"],
          },
        };

        // __reshape — the only terminal tool (component will be replaced)
        const reshapeTool = {
          name: "__reshape",
          description: "Rewrite your own source code to better handle the current situation. TERMINAL: your component will be replaced. Prefer composing child AbstractComponents for sub-problems.",
          input_schema: {
            type: "object",
            properties: {
              reason: { type: "string", description: "Why you need to be rewritten and what the new version should handle" },
            },
            required: ["reason"],
          },
        };

        // Built-in introspection tools (v2 §5.2 inspection tool pattern)
        const introspectionTools = [
          {
            name: "read_atom",
            description: "Read the full current value of a shared state atom by key",
            input_schema: {
              type: "object",
              properties: { key: { type: "string", description: "The atom key to read" } },
              required: ["key"],
            },
          },
          {
            name: "write_atom",
            description: "Write a value to a shared state atom. Creates the atom if it doesn't exist.",
            input_schema: {
              type: "object",
              properties: {
                key: { type: "string", description: "The atom key to write" },
                value: { description: "The value to set (any JSON-serializable value)" },
              },
              required: ["key", "value"],
            },
          },
          {
            name: "read_component_source",
            description: "Read the source code of any authored component by its ID",
            input_schema: {
              type: "object",
              properties: { id: { type: "string", description: "The component ID (maps to /src/ac/{id}.tsx)" } },
              required: ["id"],
            },
          },
          {
            name: "list_components",
            description: "List all authored component IDs currently in the system",
            input_schema: { type: "object", properties: {} },
          },
          {
            name: "list_atoms",
            description: "List all shared state atom keys with value summaries",
            input_schema: { type: "object", properties: {} },
          },
        ];

        // Convert ToolDef[] → Anthropic API tool format
        const toAPITool = (t: ToolDef) => {
          const properties: Record<string, any> = {};
          if (t.schema) {
            for (const [key, type] of Object.entries(t.schema)) {
              properties[key] = { type };
            }
          }
          return {
            name: t.name,
            description: t.description,
            input_schema: { type: "object" as const, properties },
          };
        };

        // All API tools: respond (non-terminal), __reshape (terminal),
        // introspection (non-terminal), domain (non-terminal)
        const apiTools = [respondTool, reshapeTool, ...introspectionTools, ...allTools.map(toAPITool)];

        // Build system context
        const runtimeCtx = { runtime: ctxRuntime, atoms: (window as any).__ATOMS__ };
        const system = buildSystemContext(allTools, componentId, runtimeCtx, responseSchema);

        // Build user message with dependency values
        let userMessage = resolvedPrompt;
        if (deps.length > 0) {
          const depsDesc = deps.map(function(d: any, i: number) {
            try {
              const s = JSON.stringify(d, null, 2);
              const truncated = s && s.length > 2000 ? s.slice(0, 2000) + "...(truncated)" : s;
              return "  [" + i + "]: " + truncated;
            } catch { return "  [" + i + "]: " + String(d); }
          }).join("\n");
          userMessage += "\n\nCURRENT INPUT VALUES:\n" + depsDesc;
        }
        if (prevDeps) {
          const prevDesc = prevDeps.map(function(d: any, i: number) {
            try {
              const s = JSON.stringify(d, null, 2);
              const truncated = s && s.length > 2000 ? s.slice(0, 2000) + "...(truncated)" : s;
              return "  [" + i + "]: " + truncated;
            } catch { return "  [" + i + "]: " + String(d); }
          }).join("\n");
          userMessage += "\n\nPREVIOUS INPUT VALUES:\n" + prevDesc;
        }

        const conversationMessages: any[] = [{ role: "user", content: userMessage }];
        const extras = {
          tools: apiTools,
          tool_choice: { type: "auto" as const },
          _source: "reasoning:" + (componentId || "anonymous"),
        };

        // Multi-turn agent loop.
        // Terminates when: (1) __reshape called, (2) no tool calls, (3) maxTurns.
        // respond is non-terminal — it writes to the response slot, loop continues.

        for (let turn = 0; turn < maxTurns; turn++) {
          const turnLabel = maxTurns > 1 ? " (turn " + (turn + 1) + "/" + maxTurns + ")" : "";
          update({ turn: turn + 1, statusText: turn === 0 ? "Thinking..." : "Reasoning..." + turnLabel });

          const response = await runtime.callLLM(system, conversationMessages, extras);

          if (!mountedRef.current) return;

          if (response.error) {
            update({ status: "error", error: "Reasoning error: " + response.error, statusText: null });
            return;
          }

          const data = response.data;
          const contentBlocks = data?.content || [];

          // Gather all tool_use blocks
          const allToolBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

          // Check for __reshape — TERMINAL (component will be replaced)
          const reshapeBlock = allToolBlocks.find((b: any) => b.name === "__reshape");
          if (reshapeBlock?.input) {
            update({ statusText: "Reshaping..." });
            // Process sibling tool calls (including respond) before terminating
            for (const tb of allToolBlocks) {
              if (tb.name === "respond") {
                latestResponse = tb.input as T;
              } else if (tb.name !== "__reshape") {
                try { await Promise.resolve(dispatchTool(tb.name, tb.input)); } catch {}
              }
            }
            dispatchTool("__reshape", reshapeBlock.input);
            // Component is being replaced — set final state
            update({ status: "done", response: latestResponse, statusText: null });
            return;
          }

          // No tool calls — agent is done, loop ends naturally
          if (allToolBlocks.length === 0) {
            // If agent never called respond, extract text as fallback content
            if (!latestResponse) {
              const text = contentBlocks.find((b: any) => b.type === "text")?.text || "";
              if (text) latestResponse = { content: text } as any;
            }
            break;
          }

          // Process all tool calls in this turn (including respond)
          const toolResultBlocks: any[] = [];
          for (const tb of allToolBlocks) {
            // respond — capture response, non-terminal
            if (tb.name === "respond") {
              latestResponse = tb.input as T;
              update({ response: latestResponse, statusText: "Response ready" + turnLabel });
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: tb.id,
                content: "Response received.",
              });
              continue;
            }

            // Update statusText with tool being called
            update({ statusText: "Calling " + tb.name + "..." + turnLabel });

            try {
              const res = await Promise.resolve(dispatchTool(tb.name, tb.input));
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: tb.id,
                content: res !== undefined ? (typeof res === "string" ? res : JSON.stringify(res)) : "done",
              });
            } catch (e: any) {
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: tb.id,
                content: "Error: " + (e.message || String(e)),
                is_error: true,
              });
            }
          }

          // Last allowed turn — don't loop back
          if (turn >= maxTurns - 1) break;

          // Feed results back for next turn
          conversationMessages.push({ role: "assistant", content: contentBlocks });
          conversationMessages.push({ role: "user", content: toolResultBlocks });
        }

        update({ status: "done", response: latestResponse, statusText: null, stale: false });
      } catch (err: any) {
        if (mountedRef.current) {
          update({ status: "error", error: "Reasoning error: " + (err.message || String(err)), statusText: null, stale: false });
        }
      }
    };

    // Debounce — priority shorthand or explicit debounceMs
    const priorityMap: Record<string, number> = { eager: 0, normal: 300, background: 1000 };
    const priority = optionsRef.current.priority;
    const delay = optionsRef.current.debounceMs ?? (priority ? priorityMap[priority] ?? 300 : 300);
    if (delay > 0) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doReason, delay);
    } else {
      doReason();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

// ---- useAtom ----

/**
 * Subscribe to a shared state atom.
 * Atoms are created and managed by the host runtime.
 *
 * Usage:
 *   const [value, setValue] = useAtom("myKey", defaultValue);
 */
export function useAtom<T = any>(key: string, defaultValue?: T): [T, (v: T | ((prev: T) => T)) => void] {
  const { atoms: registry } = useRuntimeContext();
  if (!registry) {
    // Fallback: no atom registry, use local state
    const [val, setVal] = useState<T>(defaultValue as T);
    return [val, setVal];
  }

  // Ensure atom exists
  const atom = registry.create(key, defaultValue);

  const value = useSyncExternalStore(
    (cb: () => void) => atom.subscribe(cb),
    () => atom.get(),
  );

  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    atom.set(v);
  }, [atom]);

  return [value as T, setValue];
}

// ---- Engagement Registry ----
// Continuous evaluation via user interaction signals.
// Data is stored in a global registry and automatically included in
// useReasoning's system context — components don't need to wire it manually.

interface EngagementMetrics {
  interactions: number;
  lastInteraction: number;
  dwellTimeMs: number;
  overrides: number;
  sectionHits: Record<string, number>;
  sessionStart: number;
}

if (!(window as any).__ENGAGEMENT__) (window as any).__ENGAGEMENT__ = {} as Record<string, EngagementMetrics>;

function getOrCreateEngagement(componentId: string): EngagementMetrics {
  const reg = (window as any).__ENGAGEMENT__;
  if (!reg[componentId]) {
    reg[componentId] = {
      interactions: 0,
      lastInteraction: 0,
      dwellTimeMs: 0,
      overrides: 0,
      sectionHits: {},
      sessionStart: Date.now(),
    };
  }
  return reg[componentId];
}

/**
 * Track user engagement with a component for continuous evaluation.
 *
 * Engagement data flows automatically into useReasoning's system context —
 * the model sees interaction counts, dwell time, overrides, and section
 * activity without manual wiring.
 *
 * Usage:
 *   const { track, trackOverride, ref } = useEngagement();
 *   return (
 *     <div ref={ref}>
 *       <button onClick={() => { track("filters"); doThing(); }}>Filter</button>
 *     </div>
 *   );
 */
export function useEngagement(componentId?: string): {
  metrics: EngagementMetrics;
  track: (section?: string) => void;
  trackOverride: () => void;
  ref: { current: HTMLElement | null };
} {
  const ctx = useContext(ToolContext);
  const id = componentId || ctx?.componentId || "anonymous";
  const metricsRef = useRef(getOrCreateEngagement(id));
  const mountTimeRef = useRef(Date.now());
  const elRef = useRef<HTMLElement | null>(null);

  // Track dwell time while mounted
  useEffect(function() {
    var startTime = Date.now();
    return function() {
      metricsRef.current.dwellTimeMs += Date.now() - startTime;
    };
  }, []);

  // Auto-track clicks on the ref element
  useEffect(function() {
    var el = elRef.current;
    if (!el) return;
    var handler = function() {
      metricsRef.current.interactions++;
      metricsRef.current.lastInteraction = Date.now();
    };
    el.addEventListener("click", handler);
    return function() { el.removeEventListener("click", handler); };
  }, []);

  var track = useCallback(function(section?: string) {
    var m = metricsRef.current;
    m.interactions++;
    m.lastInteraction = Date.now();
    if (section) {
      m.sectionHits[section] = (m.sectionHits[section] || 0) + 1;
    }
  }, []);

  var trackOverride = useCallback(function() {
    metricsRef.current.overrides++;
    metricsRef.current.lastInteraction = Date.now();
  }, []);

  return { metrics: metricsRef.current, track: track, trackOverride: trackOverride, ref: elRef };
}

// ---- Pinned State Registry ----
// State marked as "pinned" by the user is included in useReasoning's
// system context with explicit instructions not to override it.
// This resolves the "whose intent wins" question: user-controlled state
// takes precedence over model reasoning.

interface PinnedEntry {
  value: any;
  timestamp: number;
}

if (!(window as any).__PINNED__) (window as any).__PINNED__ = {} as Record<string, Record<string, PinnedEntry>>;

function getPinnedForComponent(componentId: string): Record<string, PinnedEntry> {
  var reg = (window as any).__PINNED__;
  if (!reg[componentId]) reg[componentId] = {};
  return reg[componentId];
}

/**
 * State with user intent precedence.
 *
 * When the user explicitly sets a value via `pin()`, it's marked as
 * "user-controlled" and included in useReasoning's system context so the
 * model knows not to override it.
 *
 * Usage:
 *   const [layout, pin, unpin, isPinned] = usePinned("layout", "grid");
 *   // User changes layout:
 *   pin("list");  // now pinned — reasoning won't override
 *   // To allow model to change it again:
 *   unpin();
 *
 * @returns [value, pin, unpin, isPinned]
 */
export function usePinned<T = any>(
  key: string,
  defaultValue: T,
  componentId?: string,
): [T, (value: T) => void, () => void, boolean] {
  var ctx = useContext(ToolContext);
  var id = componentId || ctx?.componentId || "anonymous";
  var [value, setValueRaw] = useState<T>(defaultValue);
  var [isPinned, setIsPinned] = useState(false);

  // Initialize from pinned registry on mount
  useEffect(function() {
    var pinned = getPinnedForComponent(id);
    if (pinned[key]) {
      setValueRaw(pinned[key].value as T);
      setIsPinned(true);
    }
  }, [id, key]);

  // Pin: set value and mark as user-controlled
  var pin = useCallback(function(newValue: T) {
    setValueRaw(newValue);
    setIsPinned(true);
    getPinnedForComponent(id)[key] = { value: newValue, timestamp: Date.now() };
  }, [id, key]);

  // Unpin: allow reasoning to change the value again
  var unpin = useCallback(function() {
    setIsPinned(false);
    delete getPinnedForComponent(id)[key];
  }, [id, key]);

  return [value, pin, unpin, isPinned];
}

/**
 * Snapshot engagement metrics for a component at a point in time.
 * Used by AbstractComponent's drift detection to compare before/after reshape.
 */
export function snapshotEngagement(componentId: string): EngagementMetrics | null {
  var reg = (window as any).__ENGAGEMENT__;
  if (!reg || !reg[componentId]) return null;
  var m = reg[componentId];
  return {
    interactions: m.interactions,
    lastInteraction: m.lastInteraction,
    dwellTimeMs: m.dwellTimeMs,
    overrides: m.overrides,
    sectionHits: { ...m.sectionHits },
    sessionStart: m.sessionStart,
  };
}
