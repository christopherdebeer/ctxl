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

interface ReasoningResult {
  content?: string;
  structured?: any;
  toolCalls?: Array<{ name: string; args: any }>;
  reshape?: { reason: string };
}

interface ReasoningOptions {
  tools?: ToolDef[];
  onToolCall?: (name: string, args: any) => any;
  debounceMs?: number;
  componentId?: string;
  maxTurns?: number;
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

function buildSystemContext(tools: ToolDef[], componentId?: string, runtimeCtx?: RuntimeContextValue | null): string {
  const id = componentId || "anonymous";
  const toolLines = tools.map(t => {
    let line = "- " + t.name + ": " + t.description;
    if (t.schema) {
      const fields = Object.entries(t.schema).map(function(e) { return e[0] + ": " + e[1]; }).join(", ");
      line += " (args: { " + fields + " })";
    }
    return line;
  }).join("\n");

  // Inspection context: atom state + sibling components (on-demand visibility)
  let inspectionBlock = "";
  try {
    const atoms = runtimeCtx?.atoms || (window as any).__ATOMS__;
    if (atoms && typeof atoms.keys === "function") {
      const atomKeys = atoms.keys();
      if (atomKeys.length > 0) {
        const atomSummary = atomKeys.map((k: string) => {
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
      const siblings = Object.keys(components).filter(k => k !== id);
      if (siblings.length > 0) {
        inspectionBlock += "\n\nSIBLING COMPONENTS: " + siblings.join(", ");
      }
    }
  } catch {}

  return "You are a React component (" + id + ") reasoning about a change in your inputs.\n\nAVAILABLE TOOLS:\n" + toolLines + inspectionBlock + "\n\nYou can call tools directly via the API. When you are done reasoning, call the reason_response tool with your final assessment.\n\nREASON_RESPONSE FIELDS:\n- \"content\": Brief text summary of your assessment (optional)\n- \"structured\": Any structured data to return to the component (optional)\n- \"reshape\": Set { reason: \"...\" } when your current source can't clearly handle what's needed. Prefer action over inaction — child AbstractComponents can handle sub-problems.\n\nBe concise. Reason about what changed and what action, if any, to take.";
}

// ---- useReasoning ----

/**
 * Delta-driven LLM reasoning hook.
 *
 * Fires when deps change (like useEffect). Sends the prompt + delta to the LLM
 * with scoped tools. Returns the reasoning result. Automatic settling via deps array.
 *
 * Usage:
 *   const result = useReasoning("Analyze this data", [data], { tools, onToolCall });
 */
export function useReasoning(
  prompt: string | ((prev: any[], next: any[]) => string),
  deps: any[],
  options: ReasoningOptions = {},
): ReasoningResult | null {
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const [isReasoning, setIsReasoning] = useState(false);
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

      setIsReasoning(true);
      fireCountRef.current++;

      try {
        const config = runtime.config;
        if (config.apiMode === "none") {
          setResult({ content: "No API configured." });
          return;
        }

        const { tools: localTools = [], onToolCall: localOnToolCall, componentId: optComponentId, maxTurns = 3 } = optionsRef.current;

        // Merge parent tools (from context) with component-local tools
        const ctx = parentCtxRef.current;
        const parentTools = ctx?.tools ?? [];
        const allTools = [...parentTools, ...localTools];
        const componentId = optComponentId || ctx?.componentId;

        // Unified dispatch: routes to parent handler, local handler, or local onToolCall
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
          // __reshape always goes to context
          if (name === "__reshape") {
            if (ctx?.reshape) { ctx.reshape(args?.reason || "self-requested"); logDispatch("reshape", "triggered"); return "reshape triggered"; }
            logDispatch("reshape", "no context");
            return undefined;
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

        // Build the reason_response tool (terminal signal — "I'm done reasoning")
        const reasonTool = {
          name: "reason_response",
          description: "Return your final reasoning result. Call this when you are done.",
          input_schema: {
            type: "object",
            properties: {
              content: { type: "string", description: "Brief assessment" },
              structured: { type: "object", description: "Structured data", additionalProperties: true },
              reshape: {
                type: "object",
                properties: { reason: { type: "string" } },
                description: "Request self-modification when current source is insufficient",
              },
            },
          },
        };

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

        // All tools sent as real Anthropic API tools
        const apiTools = [reasonTool, ...allTools.map(toAPITool)];

        // Build system context from merged tools
        const system = buildSystemContext(allTools, componentId, { runtime: ctxRuntime, atoms: (window as any).__ATOMS__ });

        // Build the user message with actual dependency values so the LLM
        // can reason about concrete data instead of a blind prompt.
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

        // Multi-turn agent loop: LLM calls tools directly via API,
        // reason_response is the terminal "I'm done" signal.
        let latestResult: ReasoningResult | null = null;

        for (let turn = 0; turn < maxTurns; turn++) {
          const response = await runtime.callLLM(system, conversationMessages, extras);

          if (!mountedRef.current) return;

          if (response.error) {
            setResult({ content: "Reasoning error: " + response.error });
            return;
          }

          const data = response.data;
          const contentBlocks = data?.content || [];

          // Check for reason_response — terminal signal
          const reasonBlock = contentBlocks.find(
            (b: any) => b.type === "tool_use" && b.name === "reason_response"
          );

          if (reasonBlock?.input) {
            const r: ReasoningResult = reasonBlock.input;
            latestResult = r;

            // Handle reshape
            if (r.reshape) {
              dispatchTool("__reshape", r.reshape);
            }
            break;
          }

          // Collect all non-reason_response tool_use blocks
          const toolUseBlocks = contentBlocks.filter(
            (b: any) => b.type === "tool_use" && b.name !== "reason_response"
          );

          if (toolUseBlocks.length === 0) {
            // No tools called — extract text as fallback
            const text = contentBlocks.find((b: any) => b.type === "text")?.text || "";
            latestResult = { content: text };
            break;
          }

          // Last allowed turn — dispatch tools but don't loop back
          if (turn >= maxTurns - 1) {
            for (const tb of toolUseBlocks) {
              dispatchTool(tb.name, tb.input);
            }
            const text = contentBlocks.find((b: any) => b.type === "text")?.text || "";
            latestResult = { content: text || "Max turns reached" };
            break;
          }

          // Dispatch each tool and collect results as tool_result blocks
          const toolResultBlocks: any[] = [];
          for (const tb of toolUseBlocks) {
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

          // Feed results back following Anthropic API conversation structure
          conversationMessages.push({ role: "assistant", content: contentBlocks });
          conversationMessages.push({ role: "user", content: toolResultBlocks });
        }

        if (latestResult) setResult(latestResult);
      } catch (err: any) {
        if (mountedRef.current) {
          setResult({ content: "Reasoning error: " + (err.message || String(err)) });
        }
      } finally {
        if (mountedRef.current) setIsReasoning(false);
      }
    };

    // Debounce — default 300ms so text-input-driven deps don't fire per-keystroke
    const delay = optionsRef.current.debounceMs ?? 300;
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

  // Attach isReasoning to the result for convenience
  if (result) (result as any)._isReasoning = isReasoning;
  return result;
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
