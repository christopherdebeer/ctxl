/**
 * Seed: /src/ctxl/hooks.ts — useReasoning and useAtom hooks for VFS components.
 *
 * These hooks bridge VFS components to the host runtime via window globals.
 * useReasoning is the core perception primitive: delta-driven LLM reasoning.
 * useAtom subscribes to shared persistent state atoms.
 */

export const SEED_CTXL_HOOKS_SOURCE = `import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";

// ---- Types ----

interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, string>;
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

// ---- Build system context from tools ----

function buildSystemContext(tools: ToolDef[], componentId?: string): string {
  const id = componentId || "anonymous";
  const toolLines = tools.map(t => {
    let line = "- " + t.name + ": " + t.description;
    if (t.schema) {
      const fields = Object.entries(t.schema).map(function(e) { return e[0] + ": " + e[1]; }).join(", ");
      line += " (args: { " + fields + " })";
    }
    return line;
  }).join("\\n");

  // Inspection context: atom state + sibling components (on-demand visibility)
  let inspectionBlock = "";
  try {
    const atoms = (window as any).__ATOMS__;
    if (atoms && typeof atoms.keys === "function") {
      const atomKeys = atoms.keys();
      if (atomKeys.length > 0) {
        const atomSummary = atomKeys.map((k: string) => {
          try {
            const v = atoms.get(k)?.get();
            const s = JSON.stringify(v);
            return "  " + k + ": " + (s && s.length > 80 ? s.slice(0, 80) + "..." : s);
          } catch { return "  " + k + ": <unreadable>"; }
        }).join("\\n");
        inspectionBlock += "\\n\\nSHARED STATE (atoms):\\n" + atomSummary;
      }
    }
    const components = (window as any).__COMPONENTS__;
    if (components) {
      const siblings = Object.keys(components).filter(k => k !== id);
      if (siblings.length > 0) {
        inspectionBlock += "\\n\\nSIBLING COMPONENTS: " + siblings.join(", ");
      }
    }
  } catch {}

  return "You are a React component (" + id + ") reasoning about a change in your inputs.\\nRespond using the reason_response tool.\\n\\nAVAILABLE TOOLS YOU CAN INVOKE (return in toolCalls array):\\n" + toolLines + inspectionBlock + "\\n\\nRESPONSE GUIDELINES:\\n- \\"content\\": Brief text summary of your assessment (optional)\\n- \\"structured\\": Any structured data to return to the component (optional)\\n- \\"toolCalls\\": Array of { name, args } for tools you want to invoke (optional)\\n- \\"reshape\\": Set { reason: \\"...\\" } when your current source can't clearly handle what's needed. Prefer action over inaction — child AbstractComponents can handle sub-problems.\\n\\nBe concise. Reason about what changed and what action, if any, to take.";
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
      const runtime = (window as any).__RUNTIME__;
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

        const { tools = [], onToolCall, componentId, maxTurns = 3 } = optionsRef.current;

        // Build the reason_response tool for structured output
        const reasonTool = {
          name: "reason_response",
          description: "Return your reasoning result",
          input_schema: {
            type: "object",
            properties: {
              content: { type: "string", description: "Brief assessment" },
              structured: { type: "object", description: "Structured data", additionalProperties: true },
              toolCalls: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    args: { type: "object", additionalProperties: true },
                  },
                  required: ["name"],
                },
                description: "Tools to invoke",
              },
              reshape: {
                type: "object",
                properties: { reason: { type: "string" } },
                description: "Request self-modification when current source is insufficient",
              },
            },
          },
        };

        // Build system context from tools (self-contained, no window global needed)
        const system = buildSystemContext(tools, componentId);

        const conversationMessages: any[] = [{ role: "user", content: resolvedPrompt }];
        const extras = {
          tools: [reasonTool],
          tool_choice: { type: "tool", name: "reason_response" },
        };

        // Multi-turn agent loop: dispatch tools, feed results back, let agent continue
        let latestResult: ReasoningResult | null = null;

        for (let turn = 0; turn < maxTurns; turn++) {
          const response = await runtime.callLLM(system, conversationMessages, extras);

          if (!mountedRef.current) return;

          if (response.error) {
            setResult({ content: "Reasoning error: " + response.error });
            return;
          }

          const data = response.data;
          const toolBlock = data?.content?.find(
            (b: any) => b.type === "tool_use" && b.name === "reason_response"
          );

          if (!toolBlock?.input) {
            // Fallback: extract text
            const text = data?.content?.find((b: any) => b.type === "text")?.text || "";
            latestResult = { content: text };
            break;
          }

          const r: ReasoningResult = toolBlock.input;
          latestResult = r;

          // Check for reshape (via reshape field OR __reshape in toolCalls)
          const reshapeInToolCalls = r.toolCalls && r.toolCalls.some((tc: any) => tc.name === "__reshape");
          const hasReshape = r.reshape || reshapeInToolCalls;

          if (hasReshape) {
            // Dispatch all tool calls including any __reshape, then stop
            if (r.toolCalls && onToolCall) {
              for (const tc of r.toolCalls) { onToolCall(tc.name, tc.args); }
            }
            // Auto-dispatch reshape field if __reshape wasn't already in toolCalls
            if (r.reshape && onToolCall && !reshapeInToolCalls) {
              onToolCall("__reshape", r.reshape);
            }
            break;
          }

          // If no tool calls or no handler, we're done
          if (!r.toolCalls || r.toolCalls.length === 0 || !onToolCall) break;

          // Last allowed turn — dispatch tool calls but don't loop back
          if (turn >= maxTurns - 1) {
            for (const tc of r.toolCalls) { onToolCall(tc.name, tc.args); }
            break;
          }

          // Dispatch tool calls and collect results for follow-up
          const toolResults: string[] = [];
          for (const tc of r.toolCalls) {
            try {
              const res = await Promise.resolve(onToolCall(tc.name, tc.args));
              toolResults.push(tc.name + ": " + (res !== undefined ? (typeof res === "string" ? res : JSON.stringify(res)) : "done"));
            } catch (e: any) {
              toolResults.push(tc.name + ": error — " + (e.message || String(e)));
            }
          }

          // Feed tool results back to LLM for next turn
          conversationMessages.push({ role: "assistant", content: data.content });
          conversationMessages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: "Tool results:\\n" + toolResults.join("\\n") + "\\n\\nContinue reasoning. If further action is needed, invoke more tools or request reshape. Otherwise return your assessment.",
              },
            ],
          });
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

    // Debounce
    const delay = optionsRef.current.debounceMs ?? 0;
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
  const registry = (window as any).__ATOMS__;
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
`;
