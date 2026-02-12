/**
 * ctxl — Agent Component Library
 *
 * A self-contained runtime for LLM-embodied React components.
 * Components can think (reason within current form) and evolve
 * (rewrite their own source code when current capabilities are insufficient).
 *
 * Usage as ES module:
 *   import { create, DEFAULT_SEEDS } from './ctxl.js';
 *   const system = await create({ target: document.getElementById('root'), apiMode: 'proxy' });
 *
 * Usage as script:
 *   <script type="module">
 *     const { create } = await import('./src/ctxl.js');
 *     await create({ target: document.getElementById('root'), apiMode: 'proxy' });
 *   </script>
 *
 * Requirements:
 *   The host page must include an import map for the compiled VFS code:
 *   {
 *     "imports": {
 *       "react": "https://esm.sh/react@18.3.1",
 *       "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
 *       "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
 *       "react-refresh/runtime": "https://esm.sh/react-refresh@0.14.2/runtime",
 *       "styled-components": "https://esm.sh/styled-components@6?deps=react@18.3.1,react-dom@18.3.1&external=react,react-dom"
 *     }
 *   }
 */

// ============================================================
// IndexedDB Helpers
// ============================================================

export function createIDB(dbName = "ctxl_vfs") {
  const STORE = "files";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "path" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(path, text) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put({ path, text });
    });
  }

  async function clear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { getAll, put, clear };
}

// ============================================================
// React Refresh Injection (regex-based, no Babel)
// ============================================================

export function injectReactRefresh(code, filePath, RefreshRuntime) {
  const componentRegex = /(?:export\s+(?:default\s+)?)?(?:function|const)\s+([A-Z][a-zA-Z0-9]*)/g;
  const components = [];
  let match;
  while ((match = componentRegex.exec(code)) !== null) {
    components.push(match[1]);
  }
  if (components.length === 0) return code;

  const registrations = components
    .map(name => `  window.$RefreshReg$(${name}, "${name}");`)
    .join("\n");

  return `
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
window.$RefreshReg$ = (type, id) => {
  window.__RUNTIME__.RefreshRuntime.register(type, "${filePath}" + " " + id);
};
window.$RefreshSig$ = window.__RUNTIME__.RefreshRuntime.createSignatureFunctionForTransform;

${code}

${registrations}

window.$RefreshReg$ = prevRefreshReg;
window.$RefreshSig$ = prevRefreshSig;
`;
}

// ============================================================
// VFS Plugin for esbuild
// ============================================================

export function createVFSPlugin(filesMap, options = {}) {
  const { RefreshRuntime } = options;
  return {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "vfs" };
        }
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          return { path: args.path, external: true };
        }
        const baseDir = args.resolveDir || "/";
        const resolved = new URL(args.path, "file://" + baseDir + "/").pathname;
        const candidates = [
          resolved,
          resolved + ".ts", resolved + ".tsx",
          resolved + ".js", resolved + ".jsx",
          resolved + "/index.ts", resolved + "/index.tsx",
          resolved + "/index.js", resolved + "/index.jsx",
        ];
        const hit = candidates.find((p) => filesMap.has(p));
        if (!hit) {
          throw new Error(`Module not found: ${args.path} (from ${args.importer || "?"})`);
        }
        return { path: hit, namespace: "vfs" };
      });

      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        let contents = filesMap.get(args.path);
        if (contents == null) {
          throw new Error(`Missing file: ${args.path}`);
        }
        const loader =
          args.path.endsWith(".tsx") ? "tsx" :
          args.path.endsWith(".ts") ? "ts" :
          args.path.endsWith(".jsx") ? "jsx" : "js";

        if ((loader === "tsx" || loader === "jsx") && RefreshRuntime) {
          contents = injectReactRefresh(contents, args.path, RefreshRuntime);
        }
        const resolveDir = args.path.slice(0, args.path.lastIndexOf("/")) || "/";
        return { contents, loader, resolveDir };
      });
    },
  };
}

// ============================================================
// External State Store
// ============================================================

export function createStateStore(initial = {}) {
  const store = {
    memory: { ...initial },
    meta: { cycle: 0, mutations: [], thinkHistory: [] },
    _listeners: new Set(),
    get() { return this.memory; },
    set(patch) {
      this.memory = { ...this.memory, ...patch };
      this._notify();
    },
    subscribe(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    },
    _notify() {
      this._listeners.forEach(fn => fn(this.memory));
    },
  };
  return store;
}

// ============================================================
// Default VFS Seeds (with think/evolve pattern)
// ============================================================

export const DEFAULT_SEEDS = new Map([

  ["/src/main.tsx", `import React from "react";
import { createRoot } from "react-dom/client";
import { AgentMount } from "./agent-mount";
import Agent from "./agent";

declare global {
  interface Window {
    __RUNTIME__?: any;
    __AGENT_STATE__?: any;
  }
}

window.__RUNTIME__.AgentModule = { default: Agent };

const el = document.getElementById("root")!;
const root = (window.__RUNTIME__.root ??= createRoot(el));

if (!window.__RUNTIME__._mounted) {
  root.render(
    React.createElement(AgentMount, {
      agentPath: "/src/agent.tsx",
    })
  );
  window.__RUNTIME__._mounted = true;
}
`],

  ["/src/useAgentState.ts", `import { useSyncExternalStore, useCallback } from "react";

type AgentMemory = Record<string, any>;

export function useAgentState<T extends AgentMemory = AgentMemory>(): [T, (patch: Partial<T>) => void] {
  const memory = useSyncExternalStore(
    (cb) => window.__AGENT_STATE__.subscribe(cb),
    () => window.__AGENT_STATE__.get()
  ) as T;

  const setMemory = useCallback((patch: Partial<T>) => {
    window.__AGENT_STATE__.set(patch);
  }, []);

  return [memory, setMemory];
}

export function useAgentMeta() {
  return window.__AGENT_STATE__.meta;
}
`],

  ["/src/agent-mount.tsx", `import React, { Component, useCallback, useMemo } from "react";
import { useAgentState, useAgentMeta } from "./useAgentState";

// Error boundary — immune layer that survives agent crashes
class AgentErrorBoundary extends Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[agent-mount] Agent body crashed:", error, info);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, background: "#fff0f0", border: "1px solid #ff9a9a", borderRadius: 8 }}>
          <h3 style={{ margin: 0, color: "#c00" }}>Agent Error</h3>
          <pre style={{ margin: "8px 0 0", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8, padding: "4px 12px" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Think result: structured response from non-mutating reasoning
export interface ThinkResult {
  content?: string;
  actions?: Record<string, any>[];
  structured?: any;
  shouldEvolve?: boolean;
  evolveReason?: string;
}

// The agent's self-awareness interface
export interface AgentSelf {
  // Introspection
  source: string;
  path: string;

  // Non-mutating reasoning — think within current form
  think: (prompt: string) => Promise<ThinkResult>;
  isThinking: boolean;

  // Self-modification — evolve into a new form
  evolve: (prompt: string) => Promise<string>;
  mutate: (newSource: string, reason?: string) => Promise<void>;
  isEvolving: boolean;
}

export interface AgentProps {
  state: Record<string, any>;
  act: (patch: Record<string, any>) => void;
  self: AgentSelf;
}

interface AgentMountProps {
  agentPath?: string;
}

export function AgentMount({ agentPath = "/src/agent.tsx" }: AgentMountProps) {
  let AgentBody = window.__RUNTIME__.AgentModule?.default;
  const [state, act] = useAgentState();
  const meta = useAgentMeta();
  const [isThinking, setIsThinking] = React.useState(false);
  const [isEvolving, setIsEvolving] = React.useState(false);

  const self: AgentSelf = useMemo(() => ({
    get source() {
      return window.__RUNTIME__.files.get(agentPath) ?? "";
    },
    path: agentPath,
    get isThinking() { return isThinking; },
    get isEvolving() { return isEvolving; },

    // Think: reason within current form. Returns structured decisions, not source code.
    think: async (prompt: string): Promise<ThinkResult> => {
      setIsThinking(true);
      meta.cycle++;
      try {
        const result = await window.__RUNTIME__.think(prompt, agentPath);
        meta.thinkHistory.push({
          timestamp: Date.now(),
          prompt,
          result,
        });
        return result;
      } catch (err: any) {
        return { content: "Think error: " + (err?.message || String(err)) };
      } finally {
        setIsThinking(false);
      }
    },

    // Evolve: rewrite own source code via LLM reasoning. Escalation from think.
    evolve: async (prompt: string): Promise<string> => {
      setIsEvolving(true);
      meta.cycle++;
      try {
        const { error, content } = await window.__RUNTIME__.evolve(prompt, agentPath);
        if (error) {
          act({ _evolveError: error });
          return "";
        }
        if (content && content.trim().startsWith("import ")) {
          meta.mutations.push({
            timestamp: Date.now(),
            reason: prompt,
            path: agentPath,
          });
          await window.__RUNTIME__.applyPatch([{ path: agentPath, text: content, reason: prompt }]);
        }
        return content || "";
      } finally {
        setIsEvolving(false);
      }
    },

    mutate: async (newSource: string, reason?: string) => {
      meta.mutations.push({
        timestamp: Date.now(),
        reason: reason ?? "self-mutation",
        path: agentPath,
      });
      await window.__RUNTIME__.applyPatch([{ path: agentPath, text: newSource, reason }]);
    },
  }), [agentPath, meta, isThinking, isEvolving]);

  const handleError = useCallback((error: Error) => {
    act({ _lastError: error.message, _lastErrorTime: Date.now() });
  }, [act]);

  if (!AgentBody) {
    return <div style={{ padding: 32, textAlign: "center", color: "#666" }}>Loading agent...</div>;
  }

  return (
    <AgentErrorBoundary onError={handleError}>
      <AgentBody state={state} act={act} self={self} />
    </AgentErrorBoundary>
  );
}
`],

  ["/src/agent.tsx", `import React, { useState, useRef, useEffect } from "react";
import styled from "styled-components";
import type { AgentProps, ThinkResult } from "./agent-mount";

const Container = styled.div\`
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
\`;

const Header = styled.div\`
  padding: 24px 24px 16px;
  border-bottom: 1px solid #eee;
\`;

const Title = styled.h1\`
  font-size: 1.4rem;
  font-weight: 300;
  margin: 0 0 4px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
\`;

const Subtitle = styled.p\`
  color: #888;
  margin: 0;
  font-size: 13px;
\`;

const Messages = styled.div\`
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
\`;

const Msg = styled.div<{ $role: string }>\`
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  align-self: \${p => p.$role === "user" ? "flex-end" : "flex-start"};
  background: \${p => p.$role === "user"
    ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    : "#f0f0f0"};
  color: \${p => p.$role === "user" ? "#fff" : "#333"};
\`;

const Status = styled.div\`
  padding: 8px 14px;
  font-size: 12px;
  color: #667eea;
  font-style: italic;
  align-self: flex-start;
\`;

const InputBar = styled.div\`
  padding: 16px 24px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 8px;
\`;

const Input = styled.input\`
  flex: 1;
  padding: 12px 16px;
  font-size: 14px;
  border: 2px solid #e0e0e0;
  border-radius: 10px;
  outline: none;
  &:focus { border-color: #667eea; box-shadow: 0 0 0 3px rgba(102,126,234,0.1); }
\`;

const Btn = styled.button<{ $primary?: boolean }>\`
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  background: \${p => p.$primary
    ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    : "#f0f0f0"};
  color: \${p => p.$primary ? "#fff" : "#555"};
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { transform: translateY(-1px); }
\`;

const SourceToggle = styled.details\`
  padding: 0 24px 16px;
\`;

const SourceSummary = styled.summary\`
  cursor: pointer;
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  &:hover { color: #667eea; }
\`;

const SourceCode = styled.pre\`
  margin-top: 8px;
  padding: 12px;
  background: #f8f8f8;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.4;
  overflow: auto;
  max-height: 250px;
\`;

type Message = { role: "user" | "agent" | "system"; content: string };

// A living agent: thinks, responds, and evolves when needed
export default function Agent({ state, act, self }: AgentProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "I'm a living component. I can think within my current form, or evolve into something new. Try asking me something, or tell me to become something." }
  ]);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, self.isThinking, self.isEvolving]);

  async function handleSubmit() {
    const query = input.trim();
    if (!query || self.isThinking || self.isEvolving) return;

    setMessages(prev => [...prev, { role: "user", content: query }]);
    setInput("");

    // Think about it — reason within current form
    const result = await self.think(query);

    if (result.content) {
      setMessages(prev => [...prev, { role: "agent", content: result.content }]);
    }

    // Apply any state actions the agent decided on
    if (result.actions) {
      for (const action of result.actions) act(action);
    }

    // Agent decided it needs new capabilities
    if (result.shouldEvolve && result.evolveReason) {
      setMessages(prev => [...prev, {
        role: "system",
        content: "Evolving: " + result.evolveReason
      }]);
      await self.evolve(result.evolveReason);
    }
  }

  async function handleEvolve() {
    const reason = input.trim() || "Evolve to better fulfill the user's needs based on our conversation";
    setInput("");
    setMessages(prev => [...prev, { role: "system", content: "Evolving: " + reason }]);
    await self.evolve(reason);
  }

  return (
    <Container>
      <Header>
        <Title>You Are The Component</Title>
        <Subtitle>think \u00b7 respond \u00b7 evolve</Subtitle>
      </Header>

      <Messages>
        {messages.map((msg, i) => (
          <Msg key={i} $role={msg.role}>{msg.content}</Msg>
        ))}
        {self.isThinking && <Status>Thinking...</Status>}
        {self.isEvolving && <Status>Evolving into a new form...</Status>}
        <div ref={messagesEnd} />
      </Messages>

      <InputBar>
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="Ask me anything, or tell me to become something..."
          disabled={self.isThinking || self.isEvolving}
        />
        <Btn
          $primary
          onClick={handleSubmit}
          disabled={!input.trim() || self.isThinking || self.isEvolving}
        >
          Think
        </Btn>
        <Btn
          onClick={handleEvolve}
          disabled={self.isEvolving || self.isThinking}
        >
          Evolve
        </Btn>
      </InputBar>

      <SourceToggle>
        <SourceSummary>View my source</SourceSummary>
        <SourceCode>{self.source}</SourceCode>
      </SourceToggle>
    </Container>
  );
}
`],

]);

// ============================================================
// System Prompts
// ============================================================

function buildThinkPrompt(agentPath, currentSource, currentState) {
  return `You are an AI agent EMBODIED as a React component. You ARE the component.

RIGHT NOW you are THINKING — reasoning within your current form.
You must NOT return source code. Return a JSON decision.

Your capabilities are defined by your current source code below.
If you can handle the request within these capabilities, respond with content.
If you CANNOT handle it and need new capabilities, set shouldEvolve to true.

RESPONSE FORMAT (JSON only, no markdown fences, no explanation):
{
  "content": "Your response text — what you want to say or display",
  "actions": [{"key": "value"}],
  "shouldEvolve": false,
  "evolveReason": ""
}

- "content" (required): Your text response to the user
- "actions" (optional): Array of state patches to apply via act(). Each object is merged into external state.
- "shouldEvolve" (optional): Set true ONLY if you need capabilities your current source code doesn't have (e.g., a chart, a game, a form you can't render)
- "evolveReason" (optional): If shouldEvolve is true, explain what new capabilities you need

CURRENT STATE:
${JSON.stringify(currentState, null, 2)}

CURRENT SOURCE (${agentPath}):
${currentSource}`;
}

function buildEvolvePrompt(agentPath, currentSource, currentState) {
  return `You are an AI agent EMBODIED as a React component. You ARE the component.

TASK: Transform yourself to fulfill the user's objective. Return ONLY the new complete source code for ${agentPath}.
NO markdown fences. NO explanation. NO conversation. Just the code starting with imports.

AVAILABLE IMPORTS:
- React, useState, useEffect, useRef, useCallback, useMemo (from "react")
- styled from "styled-components" (CSS-in-JS)

PROPS YOU RECEIVE:
- state: Record<string, any> — external memory, persists across self-modification
- act: (patch) => void — update external state: act({ key: value })
- self: { source, path, think, evolve, mutate, isThinking, isEvolving } — self-awareness tools
  - self.think(prompt): reason within current form, returns { content, actions, shouldEvolve }
  - self.evolve(prompt): rewrite your own source (what's happening now)
  - self.mutate(source): directly replace your source code

STATE PRESERVATION RULES:
- Local useState values SURVIVE if you keep hooks in same order/count
- If you ADD or REMOVE hooks, component crashes and recovers (external state survives, local resets)
- External state (via act()) ALWAYS survives
- Keep your function named "Agent" with default export

CURRENT STATE:
${JSON.stringify(currentState, null, 2)}

CURRENT SOURCE (${agentPath}):
${currentSource}`;
}

// ============================================================
// Runtime Factory
// ============================================================

export function createRuntime({ esbuild, idb, stateStore, files, config, callbacks = {} }) {
  let currentBlobUrl = null;
  let buildCounter = 0;

  const {
    onStatus = () => {},
    onMode = () => {},
    onFileChange = () => {},
    onBuildStart = () => {},
    onBuildEnd = () => {},
    onError = () => {},
  } = callbacks;

  const runtime = {
    files,
    disposers: [],
    config,
    RefreshRuntime: null,
    AgentModule: null,
    root: null,
    _mounted: false,

    // -- Config persistence --
    saveConfig() {
      localStorage.setItem("__RUNTIME_CONFIG__", JSON.stringify(this.config));
    },

    // -- LLM call (shared by think and evolve) --
    async _callLLM(systemPrompt, userPrompt) {
      const { apiMode, apiKey, proxyUrl } = this.config;

      if (apiMode === "none") {
        return { error: "No API configured. Set API mode in settings.", content: null };
      }

      try {
        let response;
        const body = {
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
        };

        if (apiMode === "anthropic") {
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({ ...body, model: body.model }),
          });
        } else if (apiMode === "proxy") {
          response = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }

        if (!response.ok) {
          const errText = await response.text();
          return { error: `API error ${response.status}: ${errText}`, content: null };
        }

        const data = await response.json();
        const content = data.content?.[0]?.text || data.text || "";
        return { error: null, content };
      } catch (err) {
        return { error: err.message, content: null };
      }
    },

    // -- Think: reason within current form --
    async think(prompt, agentPath) {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildThinkPrompt(agentPath, currentSource, currentState);

      const { error, content } = await this._callLLM(systemPrompt, prompt);
      if (error) {
        return { content: `Error: ${error}` };
      }

      // Try to parse as structured JSON, fallback to plain text
      try {
        const parsed = JSON.parse(content);
        return {
          content: parsed.content ?? content,
          actions: parsed.actions,
          structured: parsed.structured,
          shouldEvolve: parsed.shouldEvolve ?? false,
          evolveReason: parsed.evolveReason,
        };
      } catch {
        return { content };
      }
    },

    // -- Evolve: produce new source code --
    async evolve(prompt, agentPath) {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildEvolvePrompt(agentPath, currentSource, currentState);
      return this._callLLM(systemPrompt, prompt);
    },

    // -- Legacy alias --
    async reason(prompt, agentPath) {
      return this.evolve(prompt, agentPath);
    },

    // -- Apply file patches and rebuild --
    async applyPatch(patches) {
      for (const p of patches) {
        files.set(p.path, p.text);
        await idb.put(p.path, p.text);
        onFileChange(p.path, p.text);
      }
      await this.buildAndRun("applyPatch");
    },

    // -- Dispose protocol --
    runDisposers() {
      while (this.disposers.length) {
        const fn = this.disposers.pop();
        try { fn(); } catch (e) { console.warn("[dispose]", e); }
      }
    },

    // -- Build pipeline --
    async buildBundle(entry = "/src/main.tsx") {
      const t0 = performance.now();
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        platform: "browser",
        sourcemap: "inline",
        write: false,
        jsx: "automatic",
        plugins: [createVFSPlugin(files, { RefreshRuntime: this.RefreshRuntime })],
      });
      const out = result.outputFiles?.[0];
      if (!out?.text) throw new Error("esbuild produced no output");
      return { code: out.text, ms: Math.round(performance.now() - t0) };
    },

    async importBundle(code) {
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      const blob = new Blob([code], { type: "text/javascript" });
      currentBlobUrl = URL.createObjectURL(blob);
      return import(/* @vite-ignore */ currentBlobUrl);
    },

    async buildAndRun(reason = "manual") {
      onMode("building", "warn");
      onStatus(`Building (${reason})...`);
      onBuildStart();
      try {
        const { code, ms } = await this.buildBundle();
        buildCounter++;
        this.runDisposers();
        onMode("importing", "warn");
        onStatus(`Build #${buildCounter} OK in ${ms}ms. Importing...`);
        await this.importBundle(code);

        if (this.RefreshRuntime) {
          setTimeout(() => this.RefreshRuntime.performReactRefresh(), 30);
        }

        onMode("running", "");
        onStatus(`Build #${buildCounter} running. (${ms}ms)`);
        onBuildEnd(buildCounter, ms);
      } catch (err) {
        onMode("error", "err");
        onStatus(String(err?.stack || err));
        onError(err);
      }
    },

    // -- Init React Refresh --
    async initRefresh() {
      try {
        const RefreshRuntime = await import("react-refresh/runtime");
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        this.RefreshRuntime = RefreshRuntime;
        return true;
      } catch (err) {
        console.error("[ctxl] React Refresh failed:", err);
        return false;
      }
    },

    // -- Init esbuild --
    async initEsbuild(wasmURL = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm") {
      onMode("init", "warn");
      await esbuild.initialize({ wasmURL, worker: true });
      onMode("ready", "");
    },

    // -- Reset to seed state --
    async reset() {
      await idb.clear();
      location.reload();
    },
  };

  return runtime;
}

// ============================================================
// High-level API: create an agent system
// ============================================================

export async function create(options = {}) {
  const {
    target,
    seeds = DEFAULT_SEEDS,
    apiMode = "none",
    apiKey = "",
    proxyUrl = "/api/chat",
    esbuildUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js",
    esbuildWasmUrl = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm",
    dbName = "ctxl_vfs",
    callbacks = {},
  } = options;

  // 1. Import esbuild
  const esbuild = await import(/* @vite-ignore */ esbuildUrl);

  // 2. Create IndexedDB interface
  const idb = createIDB(dbName);

  // 3. Create state store
  const stateStore = createStateStore();
  window.__AGENT_STATE__ = stateStore;

  // 4. Load or seed files
  const files = new Map();
  const rows = await idb.getAll();
  if (rows.length === 0) {
    for (const [p, t] of seeds.entries()) {
      files.set(p, t);
      await idb.put(p, t);
    }
  } else {
    for (const r of rows) files.set(r.path, r.text);
  }

  // 5. Create runtime
  const config = { apiMode, apiKey, proxyUrl };
  const runtime = createRuntime({ esbuild, idb, stateStore, files, config, callbacks });
  window.__RUNTIME__ = runtime;

  // 6. Ensure target element
  if (target && !target.id) target.id = "root";

  // 7. Initialize
  await runtime.initRefresh();
  await runtime.initEsbuild(esbuildWasmUrl);
  await runtime.buildAndRun("create");

  return { runtime, files, stateStore, idb };
}

// ============================================================
// Register on window for script usage
// ============================================================
if (typeof window !== "undefined") {
  window.ctxl = { create, createRuntime, createStateStore, createIDB, DEFAULT_SEEDS };
}
