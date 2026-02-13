# Agent as Component: Design Review

**Reviewing the gap between the thesis in `you-are-the-component.md` and the current implementation**

v0.1 · February 2026 · Review of ctxl PoC

---

## Summary

The document makes a structurally correct argument: an agent and a React component are isomorphic. The mapping table in §2 is genuine—each row identifies a real correspondence. But the implementation actualizes only **one row** of that table (source code as mutable genome) and collapses every other agentic capability into a vehicle for reaching that one capability.

The result is "self-mutate or nothing"—a binary where the agent either rewrites its entire source code or has no agentic behavior at all. This doesn't embody "the component IS the agent." It embodies "the component is a target for an external author."

---

## 1. Where the Rigidity Lives

### 1.1 `reason()` is hardwired to produce source replacements

In `agent-mount.tsx`, the reasoning response handler (`reason()` method around line 441):

```js
if (content && content.trim().startsWith("import ")) {
  await window.__RUNTIME__.applyPatch([{ path: agentPath, text: content, reason: prompt }]);
}
```

The LLM response is either source code (→ total file replacement) or it falls through and nothing meaningful happens with it. There is no structured response parsing, no action extraction, no in-component use of the reasoning result.

### 1.2 The system prompt demands mutation

In `buildSystemPrompt()` (`index.html` around line 1072):

```
Return ONLY the new complete source code for /src/agent.tsx.
NO markdown fences. NO explanation. Just the code starting with imports.
```

The agent cannot reason without producing a full source replacement. Asking the LLM "should I show the expanded or collapsed view?" is architecturally impossible—it can only answer by rewriting itself entirely.

### 1.3 The isomorphism table is half-implemented

| Isomorphism Row (from §2) | Doc's Claim | Implementation Reality |
|---|---|---|
| State → Memory | Working + long-term memory | **Implemented.** useState + external store. |
| Props → Context | Purpose from orchestrator | **Implemented.** state, act, self. |
| useEffect → Perception | "When X changes, reconsider" | **Partial.** Only triggers self-mutation, not reasoning. |
| Event handlers → Tools | "The agent's hands" | **Partial.** Hands can only: trigger mutation or update state. |
| Render → Speech act | "Deciding how to present itself" | **Not realized.** Render is static until wholesale replacement. |
| Re-render → Reasoning loop | "Trigger → assess → express" | **Not implemented.** Re-render is plain React. "Assess" is absent. |
| Error boundary → Immune system | Catches self-modification crashes | **Implemented.** |
| Component tree → Agent hierarchy | Agents as parents/children | **Not implemented** (acknowledged as Phase 5). |

The bottom half of the table—the rows that make the agent *alive* during normal execution rather than only at mutation-time—is unrealized.

### 1.4 The seed component is a waiting room, not an agent

The current `agent.tsx` seed (lines 483-691 in `index.html`) isn't an agent—it's a launcher. It asks "what do you want to become?" and then self-destructs to become whatever the LLM writes. The component-as-agent identity starts and ends at the moment of mutation:

- **Before mutation:** empty shell, waiting for purpose
- **During mutation:** LLM writes new code
- **After mutation:** whatever the LLM produced (no longer "agent-like" unless the LLM happens to include agentic patterns)

The agent doesn't *live* in the component. It visits briefly during source rewriting.

### 1.5 `self` provides only mutation tools

```ts
interface AgentSelf {
  source: string;
  path: string;
  isReasoning: boolean;
  reason: (prompt: string) => Promise<string>;    // → triggers mutation
  mutate: (newSource: string) => Promise<void>;   // → direct mutation
}
```

The agent's entire self-awareness toolkit is about rewriting itself. There's no `think()` for in-component reasoning, no `perceive()` for structured observation, no `plan()` for action sequences. The only tool is the nuclear option.

---

## 2. Two Readings of "Agent as Component"

The doc's thesis supports two interpretations:

### Reading A: Agent as Author (current implementation)

The agent IS the component in the sense that it *constitutes* the component—it writes and rewrites the source code. The LLM is the author; the component is the artifact. The agent exists at write-time, not at run-time.

This is interesting but limited. The agent disappears between mutations. It's present only at the moment of rewriting—like a sculptor who exists only while chiseling, then vanishes until the next renovation.

### Reading B: Agent as Inhabitant (unrealized)

The agent IS the component in the sense that it *lives as* the component—reasoning, deciding, acting, and expressing all happen within the component's normal React lifecycle. The LLM is not just the author of the code but the runtime intelligence *within* the code.

In this reading:
- **Render** doesn't just execute predetermined JSX—it expresses the agent's current assessment
- **Effects** don't just trigger side effects—they're genuine perceptions that can trigger reasoning
- **Event handlers** aren't just dispatchers—they mediate decisions
- **Self-modification** is an escalation, not the only mode

Reading B is what the doc describes. Reading A is what's implemented.

---

## 3. The Core Design Problem

The reasoning loop (§7) and the self-modification system (§8) are conflated. Every call to `reason()` routes through the same pipeline:

```
trigger → LLM call → expect source code → apply as patch → rebuild
```

There's no pathway for:

```
trigger → LLM call → get decision/content → update state → re-render
```

The second pathway is what makes a component an agent during normal execution. The first pathway is what makes it an agent only during mutation events.

---

## 4. Proposal: Think vs. Evolve

Split the single `reason()` into two distinct capabilities:

### 4.1 `think()` — Reasoning Within Current Form

The agent calls the LLM and gets back **structured decisions**, not source code. The component uses these decisions to update state, render content, and take actions—all within its existing code.

```ts
interface ThinkResult {
  content?: string;          // Free-form text/content to incorporate
  actions?: Record<string, any>[]; // State patches to apply
  structured?: any;          // Typed/parsed data for the component to use
  shouldEvolve?: boolean;    // Agent signals it needs capabilities it doesn't have
  evolveReason?: string;     // Why it needs to evolve
}

self.think(prompt: string): Promise<ThinkResult>
```

**System prompt for think mode:**
```
You are a React component reasoning about what to do.
Return a JSON object with your decision. Do NOT return source code.
{ "content": "...", "actions": [...], "structured": {...} }
```

This is the agent *living* in its component—perceiving, reasoning, and acting within its current form.

### 4.2 `evolve()` — Transcending Current Form

When the agent's current capabilities aren't sufficient, it can escalate to self-modification. This is the existing `reason()` → mutation pipeline, but explicitly framed as escalation.

```ts
self.evolve(prompt: string): Promise<void>  // LLM → new source code → rebuild
self.mutate(source: string): Promise<void>  // Direct source replacement
```

**System prompt for evolve mode:** (existing behavior, unchanged)
```
Return ONLY the new complete source code...
```

### 4.3 The Spectrum

```
perceive → think → act → express     (normal agent lifecycle, no mutation)
    ↓
  evolve                              (escalation: current form insufficient)
```

The agent reasons within its current form most of the time. It evolves when it encounters something it can't handle—a new UI requirement, a capability gap, a structural limitation. This maps cleanly to the biological analogy: organisms reason and act constantly; they mutate occasionally.

---

## 5. What a Living Agent Component Looks Like

### 5.1 Instead of an empty seed waiting to self-destruct:

```tsx
export default function Agent({ state, act, self }: AgentProps) {
  const [response, setResponse] = useState<ThinkResult | null>(null);

  // Perception: when the user submits a query, THINK (not mutate)
  async function handleQuery(query: string) {
    const result = await self.think(query);
    setResponse(result);

    // Apply any state actions the agent decided on
    if (result.actions) {
      for (const action of result.actions) act(action);
    }

    // If the agent realizes it needs new capabilities, escalate
    if (result.shouldEvolve) {
      await self.evolve(result.evolveReason || query);
    }
  }

  // Expression: the agent's body reflects its current state and reasoning
  return (
    <Container>
      <Title>{state.title || "Agent"}</Title>
      {response?.content && <ResponseArea>{response.content}</ResponseArea>}
      {response?.structured && <DataView data={response.structured} />}
      <QueryInput onSubmit={handleQuery} />
    </Container>
  );
}
```

This component IS an agent: it perceives (effects), thinks (LLM within current form), acts (state mutations from think results), and expresses (render reflects current reasoning). Self-modification is available but not the default.

### 5.2 The component has a life between mutations

In the current implementation, the agent has two states: "waiting to mutate" and "just mutated." With think/evolve separation, the agent has a continuous existence:

1. User interacts → triggers `think()`
2. Agent reasons about what to do → returns structured result
3. Component re-renders with new content/state → agent expresses itself
4. New perception → more thinking → more expression
5. Eventually, agent hits a capability boundary → `evolve()` → source mutation
6. New form continues the think-act-express cycle

This is the autopoietic lifecycle the doc describes but doesn't implement.

---

## 6. Impact on `AgentMount` (Layer 1)

AgentMount currently owns one reasoning function. With this split, it owns two:

```ts
const self: AgentSelf = useMemo(() => ({
  source: ...,
  path: ...,

  // Non-mutating reasoning
  think: async (prompt: string): Promise<ThinkResult> => {
    setIsThinking(true);
    try {
      const result = await window.__RUNTIME__.think(prompt, agentPath);
      return result;
    } finally {
      setIsThinking(false);
    }
  },
  isThinking,

  // Mutating reasoning (existing behavior, renamed)
  evolve: async (prompt: string): Promise<void> => {
    setIsEvolving(true);
    try {
      const { content } = await window.__RUNTIME__.reason(prompt, agentPath);
      if (content?.trim().startsWith("import ")) {
        await window.__RUNTIME__.applyPatch([{ path: agentPath, text: content }]);
      }
    } finally {
      setIsEvolving(false);
    }
  },
  isEvolving,

  mutate: ... // direct mutation, unchanged
}), [...]);
```

### `__RUNTIME__` gains a new method:

```js
async think(prompt, agentPath) {
  // Different system prompt: "reason within your form, return JSON decisions"
  const thinkPrompt = this.buildThinkPrompt(agentPath, ...);
  const response = await this.callLLM(thinkPrompt, prompt);
  return JSON.parse(response); // structured result, not source code
},
```

The key: **`think()` uses a different system prompt** that asks for structured JSON decisions, not source code. The LLM call infrastructure is shared; the framing is different.

---

## 7. Impact on the Document

The doc's thesis (§1-2) doesn't need to change—it already describes Reading B. The implementation sections (§3-8) need updating to reflect the think/evolve split. Specifically:

- **§3 Layer Architecture:** AgentMount now hosts two reasoning modes
- **§7 The Reasoning Loop:** Split into "think loop" (in-component, frequent) and "evolve loop" (mutation, infrequent)
- **§7.2 The Settling Problem:** Think results don't cause settling (the agent should keep thinking when prompted). Evolve results do cause settling (don't re-evolve until new input).
- **§8 Self-Modification:** Reframed as escalation, not primary mode

---

## 8. Toward the Self-Contained Component

A secondary concern: the current agent requires a bespoke runtime (bootloader + VFS + esbuild-wasm + React Refresh). The "component" isn't self-contained.

For the agent-as-component paradigm to reach its potential, consider:

### 8.1 An `<Agent>` component that's composable

```tsx
<Dashboard>
  <Agent purpose="monitor API health" />
  <Agent purpose="summarize user feedback" />
  <Agent purpose="suggest optimizations" />
</Dashboard>
```

The think/evolve split naturally supports this. Agents that only `think()` don't need the VFS/esbuild infrastructure at all—they're just components with LLM-mediated reasoning. Agents that need `evolve()` require the compilation infrastructure, but that's opt-in escalation.

### 8.2 Progressive capability loading

- **Level 0:** Static component with `think()` — no build infra needed
- **Level 1:** Component with `think()` + `evolve()` — requires VFS + esbuild
- **Level 2:** Component with full self-modification + sub-component spawning — requires full runtime

Most agents would live at Level 0 most of the time. The heavy infrastructure is loaded only when an agent decides to evolve.

---

## 9. Summary of Findings

| Aspect | Current State | What's Missing |
|---|---|---|
| Reasoning | Only produces source code | Needs structured in-component reasoning (`think()`) |
| Self-modification | The only agentic capability | Should be escalation, not default |
| Agent lifecycle | Exists only at mutation-time | Should have continuous think→act→express loop |
| System prompt | Demands source code output | Needs separate think-mode prompt |
| `self` interface | `reason()` + `mutate()` | Needs `think()` + `evolve()` + `mutate()` |
| Composability | Requires full runtime | Think-only agents need no build infra |
| Isomorphism | Half-implemented | Re-render as reasoning loop is unrealized |

The thesis is sound. The implementation needs to inhabit it more fully. The agent should live in the component, not just visit it during renovations.
