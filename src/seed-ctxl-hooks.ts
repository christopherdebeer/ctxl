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
  onToolCall?: (name: string, args: any) => void;
  debounceMs?: number;
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

    // Don't fire on mount if we have no previous deps to compare
    // (first mount is handled by authoring, not reasoning)
    if (prevDeps === null) return;

    // Max fire count per mount to prevent runaway
    if (fireCountRef.current >= 10) {
      console.warn("[useReasoning] Max fire count reached, stopping");
      return;
    }

    const doReason = async () => {
      const runtime = (window as any).__RUNTIME__;
      if (!runtime) return;

      const resolvedPrompt = typeof prompt === "function"
        ? prompt(prevDeps, deps)
        : prompt;

      if (!resolvedPrompt) return;

      setIsReasoning(true);
      fireCountRef.current++;

      try {
        // Build context and call LLM
        const config = runtime.config;
        if (config.apiMode === "none") {
          setResult({ content: "No API configured." });
          return;
        }

        const { tools = [], onToolCall } = optionsRef.current;

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
                description: "Set only if self-modification is needed",
              },
            },
          },
        };

        // System prompt from host
        const system = (window as any).__REASONING_CONTEXT__ || "You are a React component reasoning about input changes. Respond using the reason_response tool.";

        const messages = [{ role: "user", content: resolvedPrompt }];
        const extras = {
          tools: [reasonTool],
          tool_choice: { type: "tool", name: "reason_response" },
        };

        // Use the host LLM transport
        const response = await runtime.callLLM(system, messages, extras);

        if (!mountedRef.current) return;

        if (response.error) {
          setResult({ content: "Reasoning error: " + response.error });
          return;
        }

        // Extract tool_use block
        const data = response.data;
        const toolBlock = data?.content?.find(
          (b: any) => b.type === "tool_use" && b.name === "reason_response"
        );

        if (toolBlock?.input) {
          const r: ReasoningResult = toolBlock.input;
          setResult(r);

          // Dispatch tool calls
          if (r.toolCalls && onToolCall) {
            for (const tc of r.toolCalls) {
              onToolCall(tc.name, tc.args);
            }
          }
        } else {
          // Fallback: extract text
          const text = data?.content?.find((b: any) => b.type === "text")?.text || "";
          setResult({ content: text });
        }
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
