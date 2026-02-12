/**
 * Default VFS seed files.
 *
 * These are template strings that get compiled by esbuild-wasm at runtime.
 * They define the initial agent component, its mount layer, and supporting hooks.
 *
 * The agent uses the think/evolve paradigm:
 *   - think(): LLM reasoning within current form (returns structured JSON)
 *   - evolve(): LLM-mediated source code rewriting (escalation)
 */

// ---- /src/main.tsx ----
const SEED_MAIN = `import React from "react";
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
`;

// ---- /src/useAgentState.ts ----
const SEED_USE_AGENT_STATE = `import { useSyncExternalStore, useCallback } from "react";

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
`;

// ---- /src/agent-mount.tsx ----
const SEED_AGENT_MOUNT = `import React, { Component, useCallback, useMemo } from "react";
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

// Agent Toolbar — immune-layer UI providing persistent think/evolve access.
// Cannot be evolved away: lives in agent-mount.tsx, outside the agent's source.
function AgentToolbar({ self, act }: { self: AgentSelf; act: (patch: Record<string, any>) => void }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [lastResponse, setLastResponse] = React.useState<string | null>(null);

  const busy = self.isThinking || self.isEvolving;

  const handleThink = async () => {
    if (!input.trim() || busy) return;
    const prompt = input.trim();
    setInput("");
    setLastResponse("...");
    const result = await self.think(prompt);
    setLastResponse(result.content || JSON.stringify(result));
    if (result.actions) {
      for (const action of result.actions) act(action);
    }
    if (result.shouldEvolve && result.evolveReason) {
      setLastResponse(prev => (prev || "") + "\\n\\u21bb " + result.evolveReason);
      await self.evolve(result.evolveReason);
    }
  };

  const handleEvolve = async () => {
    if (busy) return;
    const prompt = input.trim() || "Evolve to better serve the user based on current context";
    setInput("");
    setLastResponse("Evolving...");
    await self.evolve(prompt);
    setLastResponse("Evolved. New form is live.");
  };

  // Collapsed: small floating action button
  if (!isOpen) {
    return (
      <div
        onClick={() => setIsOpen(true)}
        title="Agent Tools (think / evolve)"
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 9999,
          width: 44, height: 44, borderRadius: "50%",
          background: busy
            ? "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
            : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "#fff", fontSize: 18, cursor: "pointer",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.3s ease",
          opacity: busy ? 1 : 0.7,
        }}
      >
        {busy ? "\\u2026" : "\\u2726"}
      </div>
    );
  }

  // Expanded: prompt bar with think/evolve
  return (
    <div style={{
      position: "fixed", bottom: 16, right: 16, left: 16, zIndex: 9999,
      background: "#fff", borderRadius: 14,
      boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      border: "1px solid #e0e0e0",
      padding: 12, maxWidth: 480, marginLeft: "auto",
    }}>
      {lastResponse && (
        <div style={{
          padding: "8px 12px", marginBottom: 8,
          background: "#f8f8f8", borderRadius: 8,
          fontSize: 13, lineHeight: 1.5, maxHeight: 150, overflowY: "auto",
          whiteSpace: "pre-wrap", color: "#333",
        }}>
          {lastResponse}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          onClick={() => { setIsOpen(false); setLastResponse(null); }}
          style={{ cursor: "pointer", fontSize: 18, color: "#999", padding: "0 4px", lineHeight: 1, userSelect: "none" }}
        >\\u00d7</div>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleThink(); }}
          placeholder={busy ? (self.isThinking ? "Thinking..." : "Evolving...") : "Think or evolve..."}
          disabled={busy}
          style={{
            flex: 1, padding: "8px 12px", fontSize: 14, fontFamily: "inherit",
            border: "2px solid #e0e0e0", borderRadius: 8, outline: "none",
          }}
        />
        <div
          onClick={handleThink}
          style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 600,
            background: (!input.trim() || busy)
              ? "#ccc"
              : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "#fff", borderRadius: 8,
            cursor: (!input.trim() || busy) ? "default" : "pointer",
            whiteSpace: "nowrap", userSelect: "none",
          }}
        >Think</div>
        <div
          onClick={handleEvolve}
          style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 600,
            background: busy ? "#ccc" : "#f0f0f0",
            color: busy ? "#999" : "#555",
            borderRadius: 8, cursor: busy ? "default" : "pointer",
            whiteSpace: "nowrap", userSelect: "none",
          }}
        >Evolve</div>
      </div>
    </div>
  );
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
    <>
      <AgentErrorBoundary onError={handleError}>
        <AgentBody state={state} act={act} self={self} />
      </AgentErrorBoundary>
      <AgentToolbar self={self} act={act} />
    </>
  );
}
`;

// ---- /src/agent.tsx ----
const SEED_AGENT = `import React, { useState, useRef, useEffect } from "react";
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

    const result = await self.think(query);

    if (result.content) {
      setMessages(prev => [...prev, { role: "agent", content: result.content }]);
    }

    if (result.actions) {
      for (const action of result.actions) act(action);
    }

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
        <Subtitle>think \\u00b7 respond \\u00b7 evolve</Subtitle>
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
`;

// ---- Assembled seed map ----
export const DEFAULT_SEEDS = new Map([
  ["/src/main.tsx", SEED_MAIN],
  ["/src/useAgentState.ts", SEED_USE_AGENT_STATE],
  ["/src/agent-mount.tsx", SEED_AGENT_MOUNT],
  ["/src/agent.tsx", SEED_AGENT],
]);
