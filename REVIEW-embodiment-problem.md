# The Embodiment Problem

**Follow-up: think/evolve is still "brain in a jar," and compose fights React**

v0.2 -- February 2026

---

## The Binary Problem

The design review diagnosed the original implementation as "self-mutate or nothing" and prescribed a split: `think()` for reasoning within current form, `evolve()` for source rewriting. That split was implemented. But look at what it actually produced:

```
think()  → call LLM → get JSON back → component decides what to do with it
evolve() → call LLM → get source back → replace entire file → rebuild
```

These are two modes of **calling an external service**. The component calls `self.think(prompt)` the same way it would call `fetch("/api/analyze")`. The LLM is still a brain in a jar. We just gave it two jars instead of one.

The vision doc says something different. Section 1:

> The LLM call is not a service the component consumes — it **is** the reconciliation logic.

And the isomorphism table maps `re-render cycle` to `reasoning loop`:

> Trigger → assess → express. React already does this; the agent makes the "assess" step deliberate.

But in the implementation, the re-render cycle and the reasoning "loop" are completely separate systems. React does trigger→render. The agent does trigger→**explicit async call**→wait→update state→render. The "assess" step isn't woven into React's cycle — it's bolted on as an imperative side-channel.

This matters because it means the agent can't reason *as part of* rendering. It can only reason *before* rendering, in a handler, and then set state to influence what renders. That's just... a component that calls an API.

---

## What Embodiment Would Actually Mean

If we take the isomorphism seriously, the agent's intelligence shouldn't be accessed via method calls. It should flow through the mechanisms React already provides.

### Reasoning as a Hook

Instead of:
```tsx
const handleClick = async () => {
  const result = await self.think("what should I do?");
  setState(result);
};
```

What if reasoning was:
```tsx
const insight = useReasoning(prompt, [dep1, dep2]);
// re-runs when deps change, just like useEffect
// returns the LLM's assessment, triggers re-render when it arrives
```

This is reasoning as perception. The agent doesn't *decide* to think — it thinks whenever its world changes, like an effect fires when its dependencies change. The LLM call IS the effect. The result IS the state. React's existing reactivity model carries the intelligence.

The settling problem (section 7.2 of the vision doc) dissolves naturally: `useReasoning` has a dependency array. It only re-fires when its inputs change. Same mechanism React uses to prevent infinite `useEffect` loops. No custom settling protocol needed — React already solved this.

### Self-Modification as a Spectrum, Not a Switch

The current model has two discrete states: **identical** (think, nothing changes in source) and **total replacement** (evolve, entire file rewritten). There's no middle ground.

But consider what self-modification actually serves. Most of the time when the agent "evolves," it's doing one of:

1. **Adding a UI element** — a new button, a display area, a panel
2. **Changing rendering logic** — different visual treatment based on state
3. **Adding a capability** — a new handler, a new hook, a new interaction pattern
4. **Structural change** — fundamentally different component architecture

These have vastly different blast radii. #1 and #2 could be state-driven — the agent doesn't need to rewrite itself to show different things, it just needs richer state. #3 might be a surgical patch rather than a full replacement. Only #4 genuinely requires the nuclear option.

The think/evolve binary forces everything into category #1 (pure state, no new capabilities) or category #4 (total rewrite). The middle is missing.

What if instead of `evolve()`, the agent had:
```
patch(diff)    → surgical edit to source (change one function, add one handler)
reshape()      → structural rewrite (the current evolve, for when architecture changes)
```

Or even more radically: what if most of what `evolve()` currently does could be achieved by the agent rendering differently based on richer state? The agent doesn't need to rewrite itself to show a chart instead of a table — it needs to *decide* to show a chart, and have both options available in its render logic. That's just... React. That's what conditional rendering *is*.

The source rewrite should be the rare escalation when the agent genuinely needs capabilities its current source doesn't provide. Not the primary interaction mode.

---

## The Compose Problem

This is where it gets sharpest. Let's trace what `compose()` does:

```
1. Agent decides it needs a child component
2. Calls self.compose(path, purpose)
3. Runtime builds a special "compose" prompt
4. LLM generates a complete component source file
5. File written to VFS + IndexedDB
6. Agent calls self.evolve() to rewrite ITSELF to import the new file
7. LLM rewrites the agent's entire source to add the import + render
8. VFS rebuilds, React Refresh swaps
```

Eight steps. Two LLM calls. A full source rewrite of the parent. To render a child component.

In React, composition is:
```tsx
<Child purpose={purpose} />
```

One line. No LLM call. No file creation. The parent doesn't need to rewrite itself.

The problem isn't that compose exists — it's that it works at the wrong level of abstraction. It operates on **files** (create a new .tsx file in the VFS) when React operates on **components** (render a component with props). The VFS is an implementation detail of the build system. Composition shouldn't need to know about it.

### What React-Native Composition Looks Like

The vision doc section 12 says:

> Parent spawns children, passes purpose via props, observes rendered output.

That's just React. A parent component renders child components and passes them props. The vision already describes React's composition model. But the implementation replaces it with a file-generation pipeline.

What if composition was:
```tsx
<Agent purpose="monitor API health" />
<Agent purpose="summarize feedback" />
```

A generic `<Agent>` component that receives purpose via props, reasons about how to fulfill that purpose, and renders accordingly. No file generation. No VFS writes. No parent rewriting itself. Just props down, UI up — React's own composition model, with an LLM providing the intelligence.

The child agent would:
- Receive `purpose` as a prop (context from orchestrator — row 2 of the isomorphism table)
- `useReasoning(purpose)` to figure out what to render
- Render its body (speech act — row 5)
- Use `useEffect` to perceive changes (row 3)
- Handle events as tools (row 4)

And if it truly hits a wall — it needs capabilities that can't be expressed as conditional rendering or state changes — *then* it escalates to source modification. But that's the exception, not the default.

### What Compose Should Be

Instead of a file-generation primitive on the runtime, compose should be React composition with an LLM-aware component:

```tsx
// The agent RENDERS its children. No file creation needed.
function Agent({ state, act, self }) {
  const tasks = useReasoning("decompose objective into tasks", [state.objective]);

  return (
    <Container>
      {tasks.map(task => (
        <AgentTask key={task.id} purpose={task.purpose} />
      ))}
    </Container>
  );
}
```

`AgentTask` is a component that receives purpose via props and uses reasoning hooks to fulfill it. The parent doesn't need to "compose" it — it just renders it. React's reconciler handles the lifecycle. If the task component is removed from the render tree, React unmounts it. If purpose changes, the reasoning hook re-fires. Standard React.

The current `compose()` essentially works around the fact that the agent can only have one source file that contains all its rendering logic. If we give the agent a generic child component that can reason about arbitrary purposes, composition becomes native.

---

## The Deeper Issue: Two Systems

The current architecture has two parallel systems:

1. **React's system:** state → render → UI. Declarative, reactive, composable.
2. **The agent system:** prompt → LLM call → parse response → update state or rewrite source. Imperative, async, non-composable.

These systems are glued together but not unified. The agent system operates *alongside* React, not *through* it.

The vision says they should be the same system. The isomorphism table says every agent concept already has a React concept. But the implementation adds new primitives (`think`, `evolve`, `compose`) rather than making the existing React primitives carry the intelligence.

What if the agent's API surface was:

| Primitive | What It Is | React Equivalent |
|-----------|-----------|-----------------|
| `useReasoning(prompt, deps)` | Perception + assessment | `useEffect` + `useState` fused |
| `act(patch)` | Motor action | Already exists, unchanged |
| `<Agent purpose={...} />` | Composition | Just a component with props |
| `self.reshape(prompt)` | Source mutation (rare escalation) | No React equivalent — this IS the novel part |

Three of four are just React with LLM-awareness. Only source mutation is genuinely new — and that's the part that requires the build infrastructure (VFS, esbuild, React Refresh).

The novel contribution of ctxl isn't think or compose — React apps call LLMs and compose components every day. The novel contribution is **a component that can rewrite its own source and survive**. That's the part worth isolating, protecting, and making excellent. Everything else should be normal React, made intelligent.

---

## What This Means for the Core

The lean core from the previous review identified 5 modules (~330 LOC). Under this lens, some of those are more core than others:

**Truly novel (no React equivalent):**
- `refresh.ts` — state-preserving source swaps
- `vfs-plugin.ts` — in-browser module resolution
- `idb.ts` — persistence across reloads

**These enable the one thing React can't do:** a component rewriting its own source and continuing to run. This is the unique contribution. ~160 lines.

**Important but not novel:**
- `state.ts` — external store (useful, but `useSyncExternalStore` + a plain object would work too)
- `prompts.ts` — LLM framing (necessary, but this is configuration, not architecture)

**Possibly fighting React:**
- `compose()` in `runtime.ts` — file-level composition where component-level would suffice
- The think/evolve split as currently structured — two discrete API modes instead of a continuous reasoning primitive

---

## A Possible Direction

Keep the infrastructure that enables source mutation (VFS, esbuild, Refresh, IDB). That's the genuine innovation — the "genome editing" machinery.

Replace the agentic API surface with React-native primitives:
- `useReasoning()` hook instead of `self.think()`
- Component composition instead of `self.compose()`
- Source mutation as rare escalation (`self.reshape()`) instead of primary mode

The runtime gets simpler. The agent-mount gets simpler. The prompts get simpler. And the agent actually *lives* in React's lifecycle instead of running a parallel system next to it.

The harness wouldn't just "get out of the way." It would mostly *disappear* — absorbed into React's existing model, with only the source-mutation machinery remaining as the genuinely new layer.

---

## The Question

Is ctxl a system for calling LLMs from React components (which many libraries already do), or is it a system where **the component and the agent are literally the same thing** (which nothing else does)?

If it's the latter, the implementation should lean hard into the isomorphism: React's mechanisms ARE the agent's mechanisms. The only addition is the ability to mutate source — and that should be infrastructure, not the primary interface.

The vision knows this. The implementation doesn't embody it yet.
