# Abstract Components: Dropping the Agent Frame

**What if the primitive isn't `<Agent>` but something closer to what React already is?**

v0.3 -- February 2026

---

## The Problem with `<Agent>`

Every previous iteration has centered on a special component type — the Agent — that has special powers (think, evolve, compose). This creates a class system in the component tree: regular components are inert, agent components are alive. That's not the isomorphism. The isomorphism says the component *already is* the agent. Every component. Not a special subtype.

`<Agent purpose="monitor health" />` is still a foreign concept bolted onto React. It says: "here is a special thing that does something normal components can't." But the vision says the opposite — that what agents do (perceive, reason, act, express) is what components *already* do. We don't need a new component type. We need to make the existing component lifecycle LLM-aware.

---

## AbstractComponent

Consider a different primitive. Not `<Agent>` — a specific type. Instead:

```tsx
<AbstractComponent
  id="metrics-dashboard"
  inputs={{ data: metrics, timeRange }}
  tools={[
    { name: "reformat", description: "Change how data is displayed" },
    { name: "report",   description: "Send observation to parent" },
  ]}
  onReport={handleChildFeedback}
/>
```

This isn't an "agent component." It's a **component that doesn't have source yet.** The `id` is its identity. The `inputs` are its props (structured data, not a purpose string). The `tools` are the actions it can take — defined by its *parent*, scoped to its role. `onReport` is the upward channel.

The lifecycle:

1. **First encounter (mount):** No source exists for id `"metrics-dashboard"`. The system authors it — LLM generates source given the inputs shape, available tools, and any existing sibling context. Source goes into VFS. Component renders.

2. **Subsequent renders (update):** Source exists. Component renders normally. When inputs change, reasoning hooks inside the component fire on the *delta* — not "here's all your state, what do you think?" but "timeRange changed from 7d to 30d, your current render shows a 7-day chart."

3. **Tool use:** The component can invoke its declared tools. `reformat` might trigger internal re-reasoning or self-modification. `report` sends structured data upward to the parent via callback.

4. **Escalation (rare):** If the component hits a genuine capability wall — it needs to render something its current source can't express — it self-modifies. This is the only time the VFS/esbuild/Refresh machinery activates. The genome edits itself.

### What the parent looks like

The parent doesn't "compose" children via an LLM call. It renders them:

```tsx
function Dashboard({ state, act }) {
  return (
    <Layout>
      <AbstractComponent
        id="health-monitor"
        inputs={{ endpoints: state.endpoints, alerts: state.alerts }}
        tools={[
          { name: "acknowledge", description: "Mark alert as seen" },
          { name: "report", description: "Escalate finding to dashboard" },
        ]}
        onReport={(data) => act({ escalations: [...state.escalations, data] })}
      />
      <AbstractComponent
        id="feedback-summary"
        inputs={{ feedback: state.userFeedback, dateRange: state.range }}
        tools={[
          { name: "categorize", description: "Group feedback by theme" },
          { name: "report", description: "Surface key insight to dashboard" },
        ]}
        onReport={(data) => act({ insights: [...state.insights, data] })}
      />
    </Layout>
  );
}
```

This is just React. The parent renders children with props. React handles the tree. The only novel part is that the children author themselves on first mount.

And the parent itself could be an AbstractComponent. The root component self-decomposes: it reasons about its inputs and decides what children to render. Those children do the same. The tree emerges from recursive self-decomposition — not from explicit `compose()` calls.

---

## Identity and Reconciliation

React already solves component identity with keys and position in the tree. A component at the same position with the same key is the "same" component across renders — it keeps its state.

Abstract components need an analogous concept for authoring identity: **has this component been authored, and should it be re-authored or just re-rendered?**

The `id` serves this role. It's a stable identifier that maps to a source artifact in the VFS. But it's not a file path — it's semantic. The system resolves `id → VFS path` internally.

The reconciliation logic:

| Situation | What Happens |
|-----------|-------------|
| New id, no source in VFS | **Author:** LLM generates source from inputs shape + tools |
| Known id, source exists, same inputs | **Render:** Normal React render, no reasoning |
| Known id, source exists, inputs changed | **Perceive:** Delta-reasoning hooks fire inside the component |
| Known id, source exists, tools changed | **Re-author:** Parent changed the contract, component needs reshaping |
| Known id, render crashes | **Error boundary:** Catch, optionally roll back source |

This maps directly to React's own mount/update/unmount lifecycle. Authoring IS mounting. Delta-reasoning IS updating. Unmounting removes the component from the tree (source persists in VFS for potential remounting).

The key insight: **authoring and reasoning are both just responses to lifecycle events.** Authoring happens on mount (component doesn't exist yet). Reasoning happens on update (inputs changed). Self-modification happens on escalation (capabilities insufficient). These aren't three different systems — they're one system responding to different lifecycle phases.

---

## Delta-Reasoning, Not State-Dump Reasoning

The current `think()` sends the entire source + entire state + a prompt to the LLM every time. That's expensive, slow, and doesn't leverage what the component already knows.

Delta-reasoning is different:

```tsx
// Inside an authored component
function MetricsDashboard({ inputs, tools }) {
  const { data, timeRange } = inputs;

  // This hook fires ONLY when timeRange changes
  // It receives the previous and current value
  useReasoning(
    (prev, next) => `Time range changed from ${prev} to ${next}.
     Current chart shows ${prev} data. Should I requery,
     adjust axes, or just re-render with cached data?`,
    [timeRange],
    {
      tools: tools,  // component's declared tools
      onResult: (result) => {
        // result might invoke a tool, update local state,
        // or (rarely) trigger self-modification
      }
    }
  );

  return <Chart data={data} range={timeRange} />;
}
```

The hook pattern gives you:

1. **Automatic settling** — deps array prevents infinite loops (React already solved this)
2. **Minimal context** — the LLM receives the delta, not the whole world
3. **Scoped tools** — only the tools declared for this component, not a generic "think about anything"
4. **React-native** — it composes with other hooks, follows rules of hooks, works with Suspense/concurrent mode

The LLM isn't being asked "what should this component do?" on every interaction. It's being asked "this specific thing changed — given your tools, how do you respond?" That's perception, not consultation.

---

## Tools as Component Interface

In the current implementation, every agent gets the same interface: `self.think()`, `self.evolve()`, `self.compose()`, `self.mutate()`. Universal tools, regardless of what the component actually does.

But the vision doc maps event handlers to tools:

> `onClick`, `onSubmit` — these are the agent's hands. The `act()` dispatcher is the motor cortex.

A component's tools should be specific to its role. The parent defines what the child can do — just like props define what a component receives. Tools are the other half: they define what actions the component can take.

```tsx
// Parent defines the child's capabilities
<AbstractComponent
  id="data-filter"
  inputs={{ data: rawData, currentFilters: filters }}
  tools={[
    { name: "applyFilter",
      description: "Add or modify a filter",
      schema: { field: "string", operator: "string", value: "any" } },
    { name: "clearFilters",
      description: "Remove all filters" },
    { name: "report",
      description: "Tell parent about data quality issues",
      schema: { issue: "string", severity: "low|medium|high" } },
  ]}
  onToolCall={(name, args) => {
    if (name === "applyFilter") act({ filters: [...filters, args] });
    if (name === "clearFilters") act({ filters: [] });
    if (name === "report") handleQualityIssue(args);
  }}
/>
```

The child component's reasoning hooks can invoke these tools when responding to input deltas. The tools flow down from parent (like props). The results flow up via callbacks (like events). Standard React data flow, with LLM reasoning in the middle.

This also means the LLM context for each component is small and focused. The system prompt doesn't need to explain the entire architecture — just: "here are your inputs, here are your tools, here's what changed. Respond."

### The `report` Tool Pattern

One tool deserves special attention: the upward channel. In React, children communicate to parents via callbacks. But those callbacks are usually mechanical — `onChange(value)`, `onSubmit(data)`.

The `report` tool is different. It's the child *reasoning about what's worth communicating*. The child perceives something in its inputs, decides it's relevant to the parent, and structures a report. The parent receives it and can reason about it in turn.

This creates a conversation *through the component tree*. Not via a chat interface — through React's own data flow. Props down (context), reports up (perception), rendered output (expression). The tree IS the communication structure.

---

## What Happens to the Runtime

Under this model, the runtime's responsibilities shift:

**Keeps:**
- VFS + IndexedDB (source persistence)
- esbuild + VFS plugin (compilation)
- React Refresh injection (state-preserving swaps)
- LLM transport (the raw API call)

**Loses:**
- `think()` — replaced by `useReasoning` hook inside components
- `evolve()` — replaced by `reshape()` as rare escalation from within the component
- `compose()` — replaced by rendering `<AbstractComponent>` (React does the composition)
- The entire prompt module as currently structured — each component's reasoning context is assembled by the hook based on its specific inputs/tools/delta

**Gains:**
- `<AbstractComponent>` wrapper that handles the author-on-mount lifecycle
- `useReasoning` hook library
- Authoring prompt builder (given inputs shape + tools, generate source)
- Tool dispatch system

The core gets *more focused*. The build infrastructure (VFS, esbuild, Refresh, IDB) remains as the novel layer. The LLM integration moves out of the runtime and into React hooks — where it becomes composable, testable, and subject to React's own lifecycle management.

---

## The Self-Decomposition Problem

The most interesting part: a root AbstractComponent that decomposes itself.

```tsx
<AbstractComponent
  id="root"
  inputs={{ objective: userObjective, context: gatherContext() }}
  tools={[
    { name: "decompose", description: "Break objective into sub-tasks" },
    { name: "render_child", description: "Decide to render a child component" },
  ]}
/>
```

On first mount, the root is authored. The LLM generates a component that, in its render function, renders further AbstractComponents. Each of those, on mount, gets authored in turn. The tree grows by recursive authoring.

But here's the important thing: **the root doesn't need to know about its children's implementation.** It just renders `<AbstractComponent id="subtask-1" inputs={...} />`. The child figures itself out. The parent can change the child's inputs or tools on re-render. If the child is removed from the render tree, React unmounts it.

This is composition without `compose()`. The parent doesn't generate the child's source — it declares the child's *role* (via inputs and tools), and the child authors itself. React manages the lifecycle. The VFS stores the artifacts. The LLM provides the intelligence.

### State Atoms vs Props

You mentioned state/atoms rather than just props. This matters. If children receive atoms (references to shared mutable state), they can:

1. **Read** the atom's current value (perception)
2. **Write** to the atom (action — scoped by the tools the parent granted)
3. **Subscribe** to changes (delta-reasoning trigger)

This is more powerful than props because it's bidirectional. The child doesn't just receive data and report back via callbacks — it participates in shared state. Multiple siblings can observe and act on the same atoms.

This maps to the existing `window.__AGENT_STATE__` external store, but scoped. Instead of one global store, each subtree could have its own state namespace. Children read/write to their namespace. The parent can observe children's state. Siblings can share atoms.

The `useAgentState` hook is already close to this — it subscribes to external state and provides a setter. The shift is from one global namespace to scoped atoms that flow through the tree.

---

## What's Actually Novel Here

Let me be honest about what's new and what isn't:

**Not novel (others do this):**
- Calling LLMs from React components
- Using LLM responses to drive rendering
- Structured tool_use for LLM actions
- Shared state / atoms

**Novel (nobody else does this):**
- **A component that authors itself on mount** — the source doesn't exist until the component is first rendered
- **Delta-reasoning as a hook** — LLM reasoning triggered by React's own dependency tracking, not by explicit calls
- **Self-modification as lifecycle** — a component can rewrite its own source and survive, with state preserved
- **Recursive self-decomposition** — a tree of components that each author their own children

The first three are enabled by the existing infrastructure (VFS, esbuild, Refresh). The fourth is enabled by making composition native to React rather than mediated by a special `compose()` API.

The build machinery (esbuild-wasm, VFS plugin, Refresh injection, IDB persistence) is the load-bearing infrastructure. Everything else — the hooks, the AbstractComponent wrapper, the tool dispatch — is a thin layer that makes the infrastructure accessible through React's own patterns.

---

## Open Questions

**1. Authoring latency.** When an AbstractComponent mounts and needs to be authored, there's a ~2-5s LLM call before anything renders. What does the user see? A Suspense fallback? A skeleton? This is the mount-time equivalent of a lazy-loaded component — React.lazy already has this pattern, but the latency is higher.

**2. Re-authoring triggers.** When should a component be re-authored vs. re-reasoned? If the parent changes the `tools` array, the child's contract changed — probably needs re-authoring. If just `inputs` changed, delta-reasoning suffices. But what about gradual drift — many small input changes that cumulatively make the original source inadequate?

**3. Identity collisions.** If two parts of the tree render `<AbstractComponent id="chart" />` with different inputs/tools, should they share source? Probably not — the id should include enough context to be unique. But then the id is really a hash of (semantic name + inputs shape + tools), which starts to feel like a cache key.

**4. Tool granularity.** How fine-grained should tools be? `{ name: "applyFilter" }` is specific. `{ name: "modify_state" }` is generic. The more specific, the better the LLM can reason. The more generic, the more flexible the component. Where's the line?

**5. The authoring prompt.** What does the system prompt look like for authoring a component that doesn't exist yet? It needs: the inputs shape (TypeScript types), the available tools, the parent's context, maybe sibling context. But NOT the parent's source — that creates coupling. The child should be authored to its interface, not to its parent's implementation.

---

## Relationship to Previous Reviews

The first review identified the lean core (~330 LOC, 5 modules). Under this model, that core stays but the surrounding system simplifies:

| Current | Abstract Component Model |
|---------|------------------------|
| `runtime.think()` | `useReasoning()` hook |
| `runtime.evolve()` | `self.reshape()` (rare, from within component) |
| `runtime.compose()` | `<AbstractComponent>` (just render children) |
| `prompts.ts` (3 prompt builders) | Per-component context assembly in hooks |
| `seed-agent-mount.ts` (error boundary + toolbar) | Error boundary stays; toolbar becomes unnecessary (components have their own tools) |
| `seed-agent.ts` (250-line seed) | The root AbstractComponent authors itself |
| `seed-use-agent-state.ts` (hooks) | Simpler: `useReasoning` + scoped atom hooks |

The harness doesn't just get out of the way. Much of it dissolves — replaced by React doing what React already does, with the build infrastructure as the enabling layer underneath.
