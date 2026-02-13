# ctxl

**Self-authoring React components with LLM reasoning.**

A React component has state, props, effects, event handlers, a render function, and a reconciliation cycle. An agent has memory, context, perceptions, tools, a speech act, and a reasoning loop. These are not analogous -- they are isomorphic. ctxl takes that literally: components that don't have source code yet are authored into existence by an LLM on first mount, then live as ordinary React components that perceive, reason, act, and -- when necessary -- rewrite their own source.

## The Isomorphism

| React Concept | Agent Concept | Implementation |
|---|---|---|
| State / Store | Memory | Scoped atoms (persistent) + `useState` (ephemeral) |
| Props | Context from orchestrator | `inputs`, `tools`, `guidelines` from parent |
| `useEffect` | Perception / Triggers | `useReasoning` hook fires on dep changes |
| Event handlers | Tools | Parent-defined, scoped actions |
| `render()` | Speech act / Body | The component's UI IS the agent |
| Re-render cycle | Reasoning loop | React's cycle with LLM in the assess step |
| Error boundary | Immune system | Crash recovery + rollback to previous source |
| Component tree | Agent hierarchy | Recursive self-decomposition |
| Source code | Genome | Mutable at runtime via build infrastructure |
| React Refresh | Cellular repair | Swap source, keep state |

## Core Concepts

### AbstractComponent

The primitive. Not a special "agent" type -- a component that doesn't have source yet.

```tsx
<AbstractComponent
  id="metrics-dashboard"
  inputs={{ data: metrics, timeRange }}
  tools={[
    { name: "reformat", description: "Change how data is displayed" },
    { name: "report", description: "Send observation to parent" },
  ]}
  guidelines="Show key metrics prominently. Highlight anomalies."
  fallback={<MetricsSkeleton />}
  onToolCall={handleToolCall}
/>
```

On first mount, the LLM authors the component's source from the input shape, tools, and guidelines. On subsequent renders, source is cached -- the component renders instantly from IndexedDB. When inputs change, `useReasoning` hooks inside the component fire on the delta. Self-modification is a rare escalation, not the default.

### useReasoning

Intelligence as a hook, not a method call.

```tsx
const analysis = useReasoning(
  (prev, next) => `Data updated. ${next.length} points. Any anomalies?`,
  [data, timeRange],
  { tools, onResult: (result) => { /* handle tool calls */ } }
);
```

Fires when deps change (like `useEffect`). Returns the LLM's assessment as state. Automatic settling via dependency arrays. The component perceives changes, reasons about them, and the result flows into render -- React's own cycle, with an LLM in the assess step.

### Scoped Atoms

External state that survives everything -- self-modification, module reimports, page reloads.

```tsx
const [metrics, setMetrics] = useAtom('metrics', []);
```

Three tiers: atoms (shared, persistent via IDB), `useState` (local, best-effort via React Refresh), variables (ephemeral).

## Build Infrastructure

The one genuinely novel layer. Everything above is React with LLM-awareness. This is the part React can't do natively.

```
Source change (authoring / self-modification)
    |
    v
VFS write + IDB persist
    |
    v
esbuild.build() with VFS plugin  (~60-100ms)
    |
    v
Blob URL -> import() -> React Refresh -> state preserved
```

- **VFS** -- `Map<string, string>` holding all component source, backed by IndexedDB
- **esbuild-wasm** -- In-browser TypeScript/JSX compilation
- **React Refresh** -- State-preserving component swaps via regex injection (no Babel)
- **IndexedDB** -- First load has LLM latency; subsequent loads are instant

## Module Structure

```
src/
  ctxl.ts              -- Public API
  types.ts             -- TypeScript interfaces

  # Build infrastructure
  vfs-plugin.ts        -- esbuild VFS resolver (65 LOC)
  refresh.ts           -- React Refresh injection (37 LOC)
  idb.ts               -- IndexedDB persistence (56 LOC)

  # Runtime
  runtime.ts           -- Build pipeline + LLM bridge + authoring
  llm.ts               -- Unified LLM transport (Anthropic / Proxy)
  atoms.ts             -- Atom registry with IDB persistence, pub/sub
  prompts.ts           -- Authoring + reasoning prompt builders

  # VFS seeds (compiled in-browser)
  seed-ctxl-hooks.ts         -- useReasoning + useAtom
  seed-abstract-component.ts -- AbstractComponent wrapper + error boundary
  seed-v2-main.ts            -- Root component
  seeds-v2.ts                -- Seed map assembly

  # Dev harness
  boot.ts              -- Dev UI + Inspect tab
```

## Getting Started

```bash
npm install
npm run dev
```

This starts both the Vite dev server and the proxy server. The proxy bridges LLM API calls from the browser.

### LLM Configuration

**Anthropic API key (direct):** Enter your key in the Dev drawer's API settings.

**Proxy server:** See [`proxy/README.md`](proxy/README.md) for setup with Anthropic or AWS Bedrock credentials.

## Documentation

### Architecture

- [**You Are The Component v2**](docs/architecture/you-are-the-component-v2.md) -- The canonical architecture document. Covers the isomorphism, AbstractComponent, useReasoning, tools, composition, state, build infrastructure, self-modification, error recovery, and the full execution plan.
- [**You Are The Component v1**](docs/architecture/you-are-the-component-v1.md) -- The original v0.4 architecture document. Establishes the thesis and layer architecture. Superseded by v2 but useful for understanding the evolution of the design.

### Design Reviews

The reviews trace the design evolution from v1 to v2, each building on the previous:

- [**Agent as Component**](docs/reviews/agent-as-component.md) -- Gap analysis between the v1 thesis and implementation. Identifies the "self-mutate or nothing" binary and proposes the think/evolve split.
- [**Core and Harness**](docs/reviews/core-and-harness.md) -- Code review of the lean core (~330 LOC) vs. the harness. Identifies the clean seams and the messy ones.
- [**The Embodiment Problem**](docs/reviews/embodiment-problem.md) -- Diagnoses think/evolve as still "brain in a jar." Prescribes `useReasoning` as a hook and composition via rendering children.
- [**Abstract Components**](docs/reviews/abstract-components.md) -- Proposes `AbstractComponent` as the primitive, dropping the special `<Agent>` type. Introduces delta-reasoning, scoped tools, and recursive self-decomposition.
