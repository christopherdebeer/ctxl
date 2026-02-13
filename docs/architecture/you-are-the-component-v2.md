# You Are The Component

**Architecture for LLM-Embodied Self-Authoring React Components**

v2.0 -- February 2026 -- Christopher & Claude

---

## 1. Thesis

A React component has state, props, effects, event handlers, a render function, and a reconciliation cycle. An agent has memory, context, perceptions, tools, a speech act, and a reasoning loop. These are not analogous -- they are isomorphic. The same structure.

The first version of this document made that claim and then undermined it by building a parallel agent system alongside React. The component called `self.think()` the way it would call any API. The LLM was still a brain in a jar, consulted on occasion. The implementation said "component plus agent." The thesis said "component *is* agent."

This version takes the isomorphism literally. There is no agent API. There is no special component type. There are components -- normal React components -- that happen not to have source code yet. The LLM authors them into existence on first mount. Once authored, they are ordinary components with ordinary React lifecycles. They perceive changes through effects. They reason through hooks. They act through tools their parent provided. They express through render. And when their current form is insufficient, they can rewrite their own source and continue running with state intact.

The only novel infrastructure is the machinery that makes source mutation survivable: a virtual filesystem, an in-browser compiler, React Refresh for state-preserving hot swaps, and IndexedDB for persistence. Everything else is React.

---

## 2. The Isomorphism

Every row is load-bearing. Every row has a direct implementation consequence.

| React Concept | Agent Concept | Implementation |
|---|---|---|
| State / Store | Memory | Scoped atoms (external, persistent) + `useState` (local, ephemeral). Both survive self-modification via different mechanisms. |
| Props | Context from orchestrator | Parent passes `inputs` (data), `tools` (agent capabilities with handlers), `handlers` (implementation callbacks), `guidelines` (hints). The component reasons within these constraints. |
| `useEffect` | Perception / Triggers | `useReasoning` hook: when deps change, the component reasons about the delta. Settling is the dependency array. |
| Event handlers | Motor actions / Tools + Handlers | Tools: agent-level capabilities with colocated handlers, auto-dispatched via React Context. Handlers: implementation callbacks for UI wiring. `report` is the canonical upward channel. |
| `render()` output | Speech act / Body | The component's visual output IS its expression. Not a view of the agent. The agent itself. |
| Re-render cycle | Reasoning loop | Trigger (input change) -> assess (`useReasoning`) -> express (render). React's own cycle, with LLM in the assess step. |
| Error boundary | Immune system | Catches self-modification crashes. Rollback to previous source. Auto-recovery from hook violations. |
| Component tree | Agent hierarchy | Parent renders children with `inputs`/`tools`. Children author themselves. Recursive self-decomposition. |
| Source code | Genome / Identity | Mutable at runtime via the build infrastructure. The component can rewrite itself and survive. |
| React Refresh | Cellular repair | Swap the source, keep the state. The cell divides without losing its ongoing processes. |

The critical difference from v1: **every row is realised in the implementation, not half the table.** The bottom half -- the rows that make the component alive during normal execution -- are carried by hooks and React's own lifecycle, not by a parallel agent system.

---

## 3. The Primitive: Abstract Components

There is no `<Agent>` component. There is no special agent type. There are components that don't have source code yet.

```tsx
<AbstractComponent
  id="metrics-dashboard"
  inputs={{ data: metrics, timeRange }}
  tools={[
    { name: "reformat", description: "Change how data is displayed",
      schema: { format: "'table' | 'chart' | 'cards'" },
      handler: (args) => setDisplayMode(args.format) },
    { name: "report", description: "Send observation to parent",
      schema: { observation: "string", severity: "'info' | 'warning'" },
      handler: (args) => handleReport(args) },
  ]}
  handlers={{
    onSelect: { description: "Called when user selects a metric", fn: handleSelect },
  }}
  guidelines="Show key metrics prominently. Highlight anomalies."
  fallback={<MetricsSkeleton />}
/>
```

### What each prop means

**`id`** -- Stable identity. Maps to a source artifact in the VFS. Determines whether this component needs authoring (no source exists) or just rendering (source cached). Not a file path -- the system resolves `id -> VFS path` internally.

**`inputs`** -- The component's data. Structured, typed. Not a purpose string -- actual values (or atoms) the component will consume. When inputs change, delta-reasoning hooks inside the component fire.

**`tools`** -- Agent-level capabilities this component can invoke during reasoning. Defined by the parent, scoped to this component's role. Each tool has a name, description, optionally a schema, and a colocated `handler` function. Tools are injected into `useReasoning` automatically via React Context (`ToolContext`) -- the child component never sees or threads them through props. The `report` tool is the canonical upward channel.

**`handlers`** -- Implementation callbacks for UI wiring. Unlike tools (which are agent-level and auto-dispatched during reasoning), handlers are passed to the child as `props.handlers` for explicit use in the UI (e.g., `onChange`, `onSelect`). Each handler has a `description` (for the authoring prompt) and an `fn` (the actual callback).

**`guidelines`** -- Minimal authoring hints. Shape constraints, UX preferences, domain rules. Kept short. Not a specification -- a nudge.

**`fallback`** -- What renders during authoring. This is the parent's responsibility, just like a Suspense fallback. Shown only on the very first mount ever -- subsequent page loads have source cached in VFS/IDB and render immediately.

### What happens under the hood

```
<AbstractComponent id="X" inputs={...} tools={...} handlers={...} />
        |
        v
  Does VFS have source for id "X"?
        |
   Yes -+-> Render the cached component, pass { inputs, handlers } as props
        |   Wrap in ToolContext.Provider (injects tools for useReasoning)
        |   Delta-reasoning hooks fire if inputs changed
        |
   No --+-> Show fallback
        |   Author: LLM generates source from inputs shape + tools + handlers + guidelines
        |   Write to VFS + IDB
        |   Build + React Refresh
        |   Render the new component
```

After first authoring, this is just a React component. It renders, re-renders, handles events, manages local state. The only difference from a hand-written component: it was written by an LLM, and it contains `useReasoning` hooks that invoke the LLM when its inputs change. Parent tools are available transparently via context.

---

## 4. Identity and Reconciliation

React reconciles components by position and key. Abstract components need a parallel reconciliation for *authoring*: has this been authored, and should it be re-authored?

### The identity key

The `id` prop is the authoring identity. It maps to a VFS path (e.g., `id="metrics-dashboard"` -> `/src/ac/metrics-dashboard.tsx`). Same id = same source artifact.

### When to author, re-author, or just render

| Situation | What Happens |
|---|---|
| New id, no source in VFS | **Author.** LLM generates source. Component renders after authoring completes. |
| Known id, source cached, inputs/tools/handlers shape unchanged | **Render.** Normal React render. No LLM call. Instant. |
| Known id, source cached, input *values* changed | **Render + perceive.** Component renders. Internal `useReasoning` hooks fire on deltas. |
| Known id, source cached, input/tools/handlers *shape* changed | **Re-author.** Parent changed the contract. LLM re-authors with existing source + delta as context. |
| Known id, render crashes | **Error boundary.** Catch, optionally roll back to previous source. |
| Component triggers self-modification | **Reshape.** Rare escalation from within. Same build pipeline as authoring. |

Shape change detection: comparison of input keys + value types, tool names + schemas, and handler names. If the structural shape of inputs, tools, or handlers changes, the component is re-authored. Value changes within the same shape are handled by delta-reasoning hooks, not re-authoring.

### Reusable components

The same source can back multiple instances. Consider iterating over a collection:

```tsx
{items.map(item => (
  <AbstractComponent
    key={item.id}
    id="item-card"
    inputs={{ item }}
    tools={itemTools}
  />
))}
```

All instances share the same authored source (`id="item-card"`). Each has its own React instance with isolated local state (expanding one card doesn't expand the others). But if they share atoms, those atoms stay in sync -- that's the atom's job, not the component's.

The `id` determines *what source to use*. The React `key` determines *which instance is which*. These are orthogonal. One authored component can have many instances, just like one `.tsx` file can be imported many times.

---

## 5. The Authoring Lifecycle

### 5.1 What the LLM receives during authoring

Authoring is the moment of genesis. The LLM is asked: "given this interface, write a component." The LLM delivers source code via the `write_component` tool (forced `tool_choice`), which guarantees structured output -- no markdown fences, no preamble, just the `src` field containing raw TSX.

The authoring prompt contains:

1. **Input shape** -- TypeScript types derived from the `inputs` prop. Not the values (risks bloat), just the shape: `{ data: MetricPoint[], timeRange: '7d' | '30d' | '90d' }`. Optionally, sample values if the parent explicitly provides them as guidelines.

2. **Tool declarations** -- Name, description, schema for each tool. These become the component's available actions.

3. **Guidelines** -- The parent's hints. Minimal. "Show key metrics prominently. Highlight anomalies."

4. **Available imports** -- React, styled-components, `useReasoning`, `useAtom`, and any other hooks the system provides.

5. **Not included by default:** state values, parent source, sibling source, detailed specifications. The authoring prompt is lean. If the component needs more context, it has tools to query for it at runtime (see section 5.2).

### 5.2 The inspection tool pattern

Borrowing from agentic search: the component doesn't receive the entire world in its authoring prompt. Instead, it can be given tools to inspect its environment at runtime:

```tsx
tools={[
  { name: "inspect_input", description: "Examine the current value of a specific input field" },
  { name: "inspect_sibling", description: "See what a sibling component is rendering" },
  { name: "query_state", description: "Read a value from shared state" },
]}
```

This inverts the context-stuffing pattern. Instead of putting everything into the system prompt (expensive, unfocused), the component pulls what it needs through tool use (cheap, targeted). The LLM decides what's worth inspecting based on its current situation.

### 5.3 Re-authoring

When the parent changes the shape of inputs or tools, the component is re-authored. But not from scratch -- the existing source is included as context:

```
You previously authored this component:
[existing source]

The interface has changed:
- Added input: `filters: FilterConfig[]`
- Removed tool: `clearAll`
- Added tool: `exportCSV`

Re-author the component to work with the new interface.
Preserve existing functionality where the interface hasn't changed.
```

The LLM sees the delta between old and new interface, plus its own existing source. It can make a minimal adaptation rather than starting over.

### 5.4 Authoring latency

First-ever mount: 2-5 seconds of LLM latency. The parent provides a `fallback` (skeleton, spinner, placeholder) during this time. This is the same UX pattern as `React.lazy` with `Suspense` -- the component loads asynchronously and appears when ready.

Subsequent page loads: zero latency. Source is cached in VFS (in-memory) backed by IndexedDB (persistent). The component renders immediately from cache. Authoring is a one-time cost.

Re-authoring (shape change): same latency as first authoring, but the user sees the previous version until the re-authored version is ready. The swap is atomic -- old version renders until new version compiles successfully.

---

## 6. Delta-Reasoning: Intelligence as Hooks

The component's runtime intelligence lives in hooks, not in method calls.

### `useReasoning`

```tsx
function useReasoning(
  prompt: string | ((prev: any[], next: any[]) => string),
  deps: any[],
  options?: {
    tools?: ToolDef[];          // component-local tools (merged with parent tools from context)
    onToolCall?: (name: string, args: any) => any;  // fallback for tools without handlers
    debounceMs?: number;
    componentId?: string;
    maxTurns?: number;          // multi-turn agent loop limit (default 3)
  }
): ReasoningResult | null;
```

Semantics:

- **Fires when deps change.** Like `useEffect`, but instead of running a side effect, it sends the delta to the LLM.
- **Returns the result as state.** The component re-renders when the result arrives. The result is available in the render body.
- **Automatic settling.** The dependency array prevents infinite loops -- same mechanism as `useEffect`. If the reasoning result doesn't change the deps, the hook doesn't re-fire.
- **Multi-turn agent loop.** After dispatching tool calls, results are fed back to the LLM for follow-up reasoning (up to `maxTurns`, default 3). The LLM can assess results, invoke more tools, or escalate to reshape.
- **Parent tools via context.** Parent-provided tools are automatically available via React Context (`ToolContext`). The child component never needs to thread tools or dispatch functions through props. Component-local tools (from options) are merged with parent tools.
- **Tool dispatch priority.** `__reshape` -> parent tool handler (via context) -> local tool handler -> `onToolCall` fallback.
- **Auto-dispatch reshape.** The `reshape` field in the reasoning result is automatically dispatched as a `__reshape` tool call, in addition to any explicit `__reshape` entries in `toolCalls`.
- **Debounce.** Optional. Prevents rapid-fire LLM calls when deps change frequently (e.g., during typing).

### Example: a component that reasons about its data

```tsx
function MetricsDashboard({ inputs, handlers }) {
  const { data, timeRange } = inputs;
  const [displayMode, setDisplayMode] = useState('table');

  // Reason about data changes
  // Parent tools (reformat, report) are available automatically via ToolContext
  const analysis = useReasoning(
    (prev, next) => `Data updated. ${next.length} points over ${timeRange}.
     Previously showing ${displayMode}. Any anomalies or format suggestions?`,
    [data, timeRange],
    { componentId: "metrics-dashboard" }
  );

  return (
    <Container>
      <Header>{analysis?.summary || `${data.length} metrics`}</Header>
      {displayMode === 'chart' ? <Chart data={data} /> : <Table data={data} />}
      {analysis?.anomalies?.map(a => <Alert key={a.id}>{a.message}</Alert>)}
    </Container>
  );
}
```

This is a React component. It has state, effects (the reasoning hook), event handling (via tool context), and a render function. The LLM is woven into the lifecycle, not bolted on. The parent's tools are invisibly available -- the child just specifies `componentId` and the hook handles dispatch through context.

### What `useReasoning` does NOT do

- It does not send the component's full source code. The component doesn't need to be self-aware to reason about data.
- It does not trigger self-modification directly. If the LLM decides self-modification is needed, it returns a `reshape` signal. The hook auto-dispatches this to the AbstractComponent wrapper via context, which handles the re-authoring.
- It does not have access to the full state store. It sees what's in its deps plus inspection context (shared atoms and sibling components are included automatically in the system prompt). Minimal context, not maximal.

---

## 7. Tools and Handlers

Tools and handlers are distinct concepts, reflecting two kinds of parent-child communication.

### Tools: agent-level capabilities

Tools are actions the component can invoke during LLM reasoning. Each tool carries a colocated `handler` function. Parent-provided tools are injected into `useReasoning` automatically via React Context (`ToolContext`) -- the child component is invisible to them; it never receives or threads them through props.

```tsx
<AbstractComponent
  id="data-filter"
  inputs={{ data: rawData, currentFilters: filters }}
  tools={[
    { name: "applyFilter",
      description: "Add or modify a filter on the data",
      schema: { field: "string", operator: "'eq'|'gt'|'lt'|'contains'", value: "any" },
      handler: (args) => dispatch({ type: 'ADD_FILTER', payload: args }) },
    { name: "clearFilters",
      description: "Remove all active filters",
      handler: () => dispatch({ type: 'CLEAR_FILTERS' }) },
    { name: "report",
      description: "Tell parent about data quality issues found during filtering",
      schema: { issue: "string", severity: "'low'|'medium'|'high'", affectedRows: "number" },
      handler: (args) => handleQualityReport(args) },
  ]}
  handlers={{
    onFilterChange: { description: "Called when user manually edits a filter", fn: handleFilterEdit },
  }}
/>
```

Dispatch routing in `useReasoning`: `__reshape` -> parent tool handler (via context) -> local tool handler -> `onToolCall` fallback. The child never writes a switch/dispatch function -- tool invocations route through the handler directly.

### Handlers: implementation callbacks

Handlers are UI-wiring callbacks (like `onChange`, `onSelect`) passed to the child as `props.handlers`. Unlike tools (which are invisible and auto-dispatched during reasoning), handlers are explicitly available in the authored component for wiring into the UI. The authoring prompt describes them so the LLM knows to use them.

### Tool granularity

There is no universal rule. It depends entirely on context.

A dashboard component might get coarse tools: `{ name: "refresh", handler: ... }`, `{ name: "report", handler: ... }`. A data editor might get fine-grained tools: `{ name: "updateCell", schema: { row, col, value }, handler: ... }`. The parent decides, because the parent knows the domain.

The `report` tool pattern deserves emphasis: it's the child reasoning about what's worth communicating upward. Not a mechanical `onChange` -- a deliberate, structured communication from child to parent. The child perceives something, decides it matters, and reports. The parent can reason about the report in turn. Conversation through the tree.

### Self-modification as a built-in tool

Every abstract component implicitly has one additional tool:

```tsx
{ name: "__reshape",
  description: "Rewrite your own source code to better handle the current situation.",
  schema: { reason: "string" } }
```

This tool is always available. The authoring prompt encourages the LLM to prefer action over inaction -- when uncertain, reshaping and composing child AbstractComponents is preferred over doing nothing. When invoked, it triggers the build infrastructure (VFS write -> esbuild -> Refresh). The component's external state survives; local state is best-effort. The `reshape` field in the reasoning result is also auto-dispatched as a `__reshape` call, so the LLM can signal reshape via either mechanism.

---

## 8. Composition

Composition is rendering children. That's it.

### A parent that decomposes itself

```tsx
function Workspace({ inputs, handlers }) {
  const { objective } = inputs;
  const [tasks, setTasks] = useState([]);

  // Reason about the objective to decompose into tasks
  // Parent tools (e.g., report) are automatically available via ToolContext
  const plan = useReasoning(
    `Objective: "${objective}". Decompose into 2-4 concrete tasks.
     Return structured task list.`,
    [objective],
    {
      tools: [{ name: "setTasks", description: "Set the task list",
                handler: (args) => setTasks(args.tasks) }],
      componentId: "workspace",
    }
  );

  // Update tasks from reasoning result
  useEffect(() => {
    if (plan?.structured?.tasks) setTasks(plan.structured.tasks);
  }, [plan?.structured?.tasks]);

  return (
    <Layout>
      {tasks.map(task => (
        <AbstractComponent
          key={task.id}
          id={`task-${task.type}`}
          inputs={{ task, context: objective }}
          tools={[
            { name: "complete", description: "Mark task as done",
              schema: { result: "any" },
              handler: (args) => handleTaskComplete(task.id, args) },
            { name: "report", description: "Report progress or blockers",
              handler: (args) => handleTaskReport(task.id, args) },
          ]}
          fallback={<TaskSkeleton title={task.title} />}
        />
      ))}
    </Layout>
  );
}
```

The parent doesn't call `compose()`. It doesn't generate files. It renders children with props. React manages the tree. Each child authors itself on first mount (or renders from cache). Tools carry their handlers directly -- no separate `onToolCall` dispatch.

Note: `id={`task-${task.type}`}` means tasks of the same type share authored source. A "data-analysis" task and a "summarization" task get different source. Two "data-analysis" tasks share source but have separate React instances and separate inputs.

### Recursive decomposition

The root component is itself an `<AbstractComponent>`:

```tsx
<AbstractComponent
  id="root"
  inputs={{ objective: userObjective }}
  tools={[
    { name: "report", description: "Report overall status to the system",
      handler: (args) => console.log("[root] report:", args) },
  ]}
  guidelines="Decompose the objective into a workspace with task components."
  fallback={<AppSkeleton />}
/>
```

The root authors itself. Its authored source renders child `<AbstractComponent>`s. Those author themselves. The tree grows by recursive self-decomposition. No orchestrator needed -- React's render cycle IS the orchestrator. Tools with handlers flow down the tree; each level's tools are injected into its children's `useReasoning` via `ToolContext`.

---

## 9. State: Scoped Atoms

The v1 architecture had a single global store (`window.__AGENT_STATE__`). This worked for a single component but doesn't scale to a tree of self-authoring components.

### Atoms

An atom is a single piece of external state with pub/sub semantics. Multiple components can read and write the same atom. Atoms survive self-modification, module reimports, and page reloads (backed by IDB).

```tsx
// Create atoms
const metricsAtom = atom<MetricPoint[]>('metrics', []);
const filtersAtom = atom<Filter[]>('filters', []);

// In a component: read + subscribe
const [metrics, setMetrics] = useAtom(metricsAtom);

// Pass atoms to children via inputs
<AbstractComponent
  id="metrics-chart"
  inputs={{ metrics: metricsAtom, filters: filtersAtom }}
/>
```

When a child receives an atom as input, it can:
1. **Read** the current value (perception)
2. **Subscribe** to changes (delta-reasoning trigger for `useReasoning` deps)
3. **Write** to it, if granted write access via tools

Atoms are the shared state primitive. Props are the per-render data. Local `useState` is ephemeral working memory. Three tiers, like v1's external/local split, but scoped instead of global.

### Atom identity

Atoms have string keys for IDB persistence: `atom('metrics', defaultValue)`. Components sharing the same atom key share state. Components with different atom keys have isolated state. The parent decides which atoms to share by passing them as inputs.

This resolves the reusable-component tension: multiple instances of `id="item-card"` each get their own local state (React handles this), but if the parent passes them the same atom, they see the same shared state. Expanding an item-card in one place doesn't expand another -- unless they share an `expanded` atom, in which case it does. The parent controls this through which atoms it passes, not through the component's source.

---

## 10. The Build Infrastructure

This is the genuinely novel layer. Everything above is React with LLM-awareness. This section is the part React can't do.

### 10.1 Virtual Filesystem (VFS)

A `Map<string, string>` holding all component source. Backed by IndexedDB for persistence across page reloads. When an abstract component is authored, its source is written here. When a component self-modifies, the new source replaces the old.

The VFS is an implementation detail. Components don't know about it. The `<AbstractComponent>` wrapper manages the VFS lifecycle transparently.

### 10.2 esbuild-wasm

In-browser TypeScript/JSX compilation. Takes VFS source, bundles it into a single ESM module, outputs a blob URL. Sub-100ms builds.

```
Source (VFS) -> esbuild.build() with VFS plugin -> ESM bundle -> Blob URL -> import()
```

The VFS plugin resolves imports against the in-memory map. Bare imports (react, styled-components) are marked external and resolved by the browser's import map.

### 10.3 React Refresh

State-preserving component swaps. When source changes, React Refresh swaps the component in the running tree without destroying local state -- provided the hook structure didn't change.

Implemented via regex-based `$RefreshReg$` injection. No Babel. The regex detects PascalCase component declarations and wraps each file with registration calls. esbuild handles JSX natively.

Tradeoff: without Babel's hook-signature tracking, hook-structure changes (adding/removing hooks) cause crashes rather than graceful remounts. The error boundary catches these. This is acceptable: structural mutations are rare escalations, and the error boundary is the immune system.

### 10.4 IndexedDB Persistence

Every VFS write is mirrored to IndexedDB. On page load, the VFS is seeded from IDB. This means:

- First-ever visit: all abstract components must be authored (LLM latency for each)
- Subsequent visits: all source is cached. Components render immediately. Zero authoring latency.

### 10.5 The build pipeline

```
Source change (authoring, re-authoring, or self-modification)
    |
    v
VFS write + IDB persist
    |
    v
esbuild.build() with VFS plugin
    |-- onResolve: map imports to VFS paths; bare imports -> external
    |-- onLoad: read source from VFS, inject React Refresh registration
    |
    v
ESM bundle output
    |
    v
Blob URL created; old URL revoked
    |
    v
import(blobUrl)
    |
    v
setTimeout(() => performReactRefresh(), 30)
    |
    v
React walks fiber tree, swaps updated components, preserves state
```

Total rebuild: ~60-100ms. Under the threshold where self-modification feels instantaneous.

### 10.6 Import map

Framework dependencies are resolved at runtime via the browser's import map:

```html
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react-refresh/runtime": "https://esm.sh/react-refresh@0.14.2/runtime",
    "styled-components": "https://esm.sh/styled-components@6?deps=react@18.3.1,react-dom@18.3.1&external=react,react-dom"
  }
}
</script>
```

The `?deps` and `&external` parameters on styled-components ensure a single React instance across all modules. Without them, hooks break silently.

---

## 11. Self-Modification: The Rare Escalation

Self-modification is not the primary interaction mode. It is the emergency exit.

### When it happens

A component's `useReasoning` hook concludes that its current source cannot handle the situation. Maybe it needs a new UI pattern it wasn't authored with. Maybe the inputs have drifted far enough from the original authoring context that the current render logic is inadequate. Maybe the user explicitly asks it to transform.

The LLM signals this by invoking the `__reshape` tool. The AbstractComponent wrapper intercepts this, initiates re-authoring with the existing source as context, writes the new source to VFS, and triggers a build.

### What survives

| State Type | Survives? | Mechanism |
|---|---|---|
| Atoms (external) | Always | Lives outside React, outside the module scope |
| `useState` (local) | If hook structure unchanged | React Refresh preserves hooks by position |
| `useRef` (local) | If hook structure unchanged | Same as useState |
| `useState` (local) | No, if hooks added/removed | Hook violation -> crash -> error boundary -> recovery |

The preemptive evacuation pattern from v1 still applies: if a component knows it needs to add hooks (structural mutation), it can evacuate critical local state to atoms first.

### Mutation history

Every self-modification is recorded:

```ts
interface Mutation {
  id: string;
  timestamp: number;
  componentId: string;     // the abstract component's id
  trigger: string;         // what prompted this
  previousSource: string;  // for rollback
  newSource: string;
  outcome: 'swap' | 'remount' | 'crash-recovery' | 'rollback';
}
```

The `previousSource` field enables rollback. The error boundary tracks consecutive crash count -- after N crashes, it rolls back to the last known-good source.

---

## 12. Error Boundaries and Recovery

Each `<AbstractComponent>` wraps its rendered child in an error boundary. This is the immune system.

### Recovery strategy

1. **First crash:** Re-render. Maybe a transient issue.
2. **Second crash (same source):** Force full remount (destroy local state, keep atoms).
3. **Third crash:** Roll back to previous source (from mutation history).
4. **Authoring failure:** Keep showing fallback. Log error. Allow retry.

The error boundary lives in the `<AbstractComponent>` wrapper -- stable infrastructure, outside the blast radius of self-modification. A component can never break its own error boundary because it can never modify it.

### Hook-order violations

Without Babel hook-signature tracking, adding/removing hooks in a self-modification causes a runtime crash. The error boundary catches this and forces a full remount. Atoms survive. Local state resets. The component continues in its new form.

This is a survivable event, not a fatal error. The biological analogy: a frameshift mutation that disrupts structure triggers crisis and recovery. The organism loses short-term memory but keeps its identity.

---

## 13. Known Hazards

**Immortal bugs.** A component self-modifies and introduces a bug, then self-modifies again with the same bug. Mitigation: mutation history is included in re-authoring context. The component (and the LLM authoring it) can see what was tried before.

**Authoring quality.** The authored component is only as good as the LLM call. Bad authoring produces bad components. Mitigation: the error boundary catches crashes. The parent can re-author by changing guidelines. The user can trigger manual re-authoring.

**Runaway reasoning.** A `useReasoning` hook whose result changes its own deps, creating an infinite loop. Mitigation: the dependency array mechanism prevents this in most cases (same as `useEffect`). Additionally, `useReasoning` has a built-in max-fire-count per render cycle.

**Authoring latency cascade.** A root component that decomposes into N children, each needing authoring. First load hits N sequential LLM calls. Mitigation: parallel authoring where children are independent. Cached after first visit.

**Style accumulation.** styled-components injects `<style>` tags that persist across hot reloads. Old styles accumulate. Mitigation: periodic full refresh clears them. Acceptable for development.

**CSP restrictions.** Blob URL imports require permissive Content-Security-Policy. Some environments block them.

**The setTimeout gap.** The 30ms delay before `performReactRefresh()` is empirical. For production, use `requestIdleCallback` chained after `requestAnimationFrame`.

---

## 14. Implementation Design

### Module structure

```
src/
  ctxl.ts              -- Public API: create(), exports all modules
  types.ts             -- All TypeScript interfaces

  # Build infrastructure (the novel layer)
  vfs-plugin.ts        -- esbuild VFS resolver (65 LOC)
  refresh.ts           -- React Refresh regex injection (37 LOC)
  idb.ts               -- IndexedDB persistence (56 LOC)

  # Host-side runtime
  runtime.ts           -- Build pipeline + LLM bridge + authoring + registry (~195 LOC)
  llm.ts               -- Unified LLM transport (~85 LOC)
  atoms.ts             -- Atom registry with IDB persistence, pub/sub (~100 LOC)

  # Prompts
  prompts.ts           -- buildAuthoringPrompt + buildReasoningContext (~135 LOC)

  # VFS seed sources (real .ts/.tsx files, imported via Vite's ?raw suffix)
  seeds/ctxl/hooks.ts              -- VFS /src/ctxl/hooks.ts: useReasoning + useAtom + ToolContext
  seeds/ctxl/abstract-component.tsx -- VFS /src/ctxl/abstract-component.tsx: AC wrapper + ToolContext.Provider + mutation history + rollback + authoring queue + freshness tracking
  seeds/ac/_registry.ts            -- VFS /src/ac/_registry.ts: component registry (initially empty)
  seeds/main.tsx                   -- VFS /src/main.tsx: renders root <AbstractComponent>
  seeds-v2.ts          -- Assembles seed map (imports seeds via ?raw)

  # Seed type-checking
  tsconfig.seeds.json  -- Separate tsconfig for seed files (IDE + npm run check:seeds)

  # Dev harness
  boot.ts              -- Dev UI + atom registry + VFS seeding + Inspect tab (components, atoms, mutations)
```

### Key interfaces

```ts
// --- Abstract Component ---

interface AbstractComponentProps {
  id: string;
  inputs?: Record<string, any>;
  tools?: ToolDef[];
  handlers?: Record<string, HandlerDef>;
  guidelines?: string;
  fallback?: React.ReactNode;
}

interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, string>;   // lightweight type hints for LLM
  handler?: (args: any) => any;      // colocated handler, auto-dispatched
}

interface HandlerDef {
  description: string;               // described in authoring prompt
  fn: (...args: any[]) => any;       // passed to child as props.handlers
}

// --- Tool Context (React Context for tool injection) ---

interface ToolContextValue {
  tools: ToolDef[];
  dispatch: (name: string, args: any) => any;
  reshape: (reason: string) => void;
  componentId: string;
}

// --- Reasoning ---

interface ReasoningResult {
  content?: string;
  structured?: any;
  toolCalls?: Array<{ name: string; args: any }>;
  reshape?: { reason: string };       // signals self-modification needed (auto-dispatched)
}

interface ReasoningOptions {
  tools?: ToolDef[];          // component-local tools (merged with parent tools from context)
  onToolCall?: (name: string, args: any) => any;  // fallback for tools without handlers
  debounceMs?: number;
  componentId?: string;
  maxTurns?: number;          // multi-turn agent loop limit (default 3)
}

// --- Atoms ---

interface Atom<T> {
  key: string;
  defaultValue: T;
  get(): T;
  set(value: T | ((prev: T) => T)): void;
  subscribe(fn: (value: T) => void): () => void;
}

// --- Mutations ---

interface Mutation {
  id: string;
  timestamp: number;
  componentId: string;
  trigger: string;
  previousSource: string;
  newSource: string;
  outcome: 'swap' | 'remount' | 'crash-recovery' | 'rollback';
}

// --- LLM ---

interface LLMConfig {
  apiMode: 'none' | 'anthropic' | 'proxy';
  apiKey: string;
  proxyUrl: string;
  model: string;
}

// --- Runtime ---

interface Runtime {
  files: Map<string, string>;
  config: LLMConfig;

  callLLM(system: string, messages: Array<{ role: string; content: any }>, extras?: Record<string, any>): Promise<LLMResponse>;
  buildAuthoringPrompt(componentId: string, inputs: Record<string, any>, tools: ToolDef[], handlers?: Record<string, string>, guidelines?: string, existingSource?: string): string;
  regenerateRegistry(): void;
  applyPatch(patches: FilePatch[]): Promise<void>;
  buildAndRun(reason?: string): Promise<void>;

  initRefresh(): Promise<boolean>;
  initEsbuild(wasmUrl?: string): Promise<void>;
  reset(): Promise<void>;
}
```

### Data flow diagram

```
        Parent Component
            |
            | inputs, tools (with handlers), handlers, guidelines, fallback
            v
    ┌─ <AbstractComponent> ─────────────────────────────┐
    |                                                    |
    |  1. Check VFS for source (by id)                   |
    |  2. If missing: author (LLM call, show fallback)   |
    |  3. If present: render cached component             |
    |  4. Wrap in ToolContext.Provider + error boundary   |
    |                                                    |
    |  ┌─ Authored Component ──────────────────────┐     |
    |  |  receives { inputs, handlers }             |     |
    |  |                                            |     |
    |  |  useReasoning(prompt, [deps])              |     |
    |  |    -> fires on dep change                  |     |
    |  |    -> multi-turn agent loop (maxTurns)     |     |
    |  |    -> parent tools via ToolContext (auto)   |     |
    |  |    -> tool dispatch via colocated handlers  |     |
    |  |    -> reshape auto-dispatched via context   |     |
    |  |                                            |     |
    |  |  useAtom(atom)                             |     |
    |  |    -> read/write shared state              |     |
    |  |    -> survives self-modification           |     |
    |  |                                            |     |
    |  |  render()                                  |     |
    |  |    -> wires props.handlers into UI          |     |
    |  |    -> may include child <AbstractComponent>|     |
    |  |    -> recursive decomposition              |     |
    |  |                                            |     |
    |  └────────────────────────────────────────────┘     |
    |                                                    |
    |  Error Boundary                                     |
    |    -> catches crashes                               |
    |    -> rollback via mutation history                  |
    └────────────────────────────────────────────────────┘
            |
            | tool handlers invoked directly (including 'report')
            v
        Parent Component
```

---

## 15. Execution Plan

### Phase 1: Foundation -- IMPLEMENTED

**Build the infrastructure and core hooks. Get one abstract component rendering.**

1. **`llm.ts`** -- DONE. `callLLM(config, system, messages, extras?)`. Unified transport used by both v1 methods and v2 hooks. 85 LOC.

2. **`atoms.ts` + `useAtom` hook** -- DONE. Host-side `createAtomRegistry()` with IDB persistence + hydration. VFS-side `useAtom(key, default)` hook via `useSyncExternalStore`. ~100 LOC host + ~30 LOC VFS.

3. **`useReasoning` hook** -- DONE. Delta-driven reasoning as VFS seed. Tracks previous deps, builds delta prompt, calls LLM with `reason_response` tool. Multi-turn agent loop (up to `maxTurns`, default 3) dispatches tool calls and feeds results back. Parent tools merged via `ToolContext`. Debounce + max-fire-count (10/mount) for settling. ~250 LOC.

4. **`prompts.ts`** -- DONE. `buildAuthoringPrompt(id, inputs, tools, guidelines?, existingSource?)` derives input shape automatically. `buildReasoningContext(id, tools)` for hook system prompts. v1 prompts preserved. ~120 LOC added.

5. **`AbstractComponent` wrapper** -- DONE as VFS seed. Identity resolution, author-on-mount, error boundary (`ComponentErrorBoundary`), shape change detection, `__reshape` tool interception. ~200 LOC.

6. **`runtime.ts`** -- DONE. Added `callLLM` (bridged), `regenerateRegistry()` (auto-generates `/src/ac/_registry.ts`), `buildAuthoringPrompt` (bridged). v1 `_callLLM`/`think` refactored to use shared `llm.ts`. v1 API fully preserved.

7. **Minimal seed** -- DONE. `main.tsx` renders `<AbstractComponent id="root" inputs={{ objective }} />` with a fallback. Registry starts empty. `boot.ts` supports `?v2` URL param + auto-detection.

**Milestone:** A page loads with `?v2`. The root AbstractComponent has no source. It authors itself via LLM. The authored component renders. On reload, it renders instantly from IDB cache.

### Phase 2: Interactivity -- IMPLEMENTED

**Make authored components alive -- reasoning, tools, self-modification.**

8. **`useReasoning` context fix** -- DONE. The hook now builds its own system context via `buildSystemContext(tools, componentId)` inline, rather than relying on a missing `window.__REASONING_CONTEXT__` global. Self-contained ~25 LOC function that formats tool declarations and response guidelines.

9. **Tool dispatch via `useReasoning`** -- DONE. Tools (with colocated handlers) and handlers (implementation callbacks) are now separate concepts. Parent tools are injected via `ToolContext` and auto-dispatched. Dispatch priority: `__reshape` -> parent tool handler (via context) -> local tool handler -> `onToolCall` fallback. The `reshape` field in reasoning results is also auto-dispatched. Authored components receive `{ inputs, handlers }` -- not `{ inputs, tools, onToolCall }`.

10. **Self-modification via `__reshape`** -- DONE. The `handleToolCall` callback intercepts `__reshape`, records a mutation entry with the current source as `previousSource`, then forces a shape mismatch to trigger re-authoring. Re-authoring includes existing source as context.

11. **Mutation history + rollback** -- DONE. `window.__MUTATIONS__` stores up to 50 `MutationEntry` records. Every authoring, re-authoring, and reshape records `previousSource` and `newSource`. Error boundary tracks consecutive crash count; on 3rd crash, `getPreviousSource()` finds the last known-good source and triggers rollback (VFS write + registry + rebuild). ~50 LOC for mutation tracking + ~25 LOC for rollback logic.

12. **Authoring prompt polish** -- DONE. Authoring now uses `write_component` tool with forced `tool_choice` -- the LLM delivers source via `{ src: "..." }` structured output, eliminating markdown fence issues entirely. Clearer `useReasoning` usage with `componentId` and function-prompt pattern. Explicit guidance on `report` tool as canonical upward channel. Better handling of null result on initial render.

**Milestone:** A component reasons about input deltas, invokes tools, reports to its parent, and can reshape itself when needed. The error boundary recovers from bad self-modifications by rolling back to previous source after 3 crashes.

### Phase 3: Composition -- IMPLEMENTED

**Recursive self-decomposition. The tree grows.**

12. **Authoring queue** -- DONE. Added `enqueueAuthoring()` to serialise VFS writes + `buildAndRun` calls while allowing LLM calls to run concurrently. Prevents race conditions when multiple children need authoring simultaneously. ~10 LOC.

13. **Child authoring** -- DONE (architecturally complete). An authored component renders `<AbstractComponent id="child" .../>`. The VFS plugin resolves `../ctxl/hooks` and `../ctxl/abstract-component` from `/src/ac/` correctly. The registry regeneration scans all `/src/ac/*.tsx` files. Independent reasoning hooks, atoms, and error boundaries per component.

14. **Shared atoms** -- DONE (architecturally complete). `useAtom(key, default)` with the same key across any component shares state via `window.__ATOMS__`. Atoms persist in IDB with `__atom:` prefix, filtered out during VFS loading.

15. **Reusable components** -- DONE (architecturally complete). Same `id` = same VFS source. Different React `key` = isolated local state. Atoms shared by key, not by component identity.

16. **Recursive decomposition** -- DONE (architecturally complete). Root is `<AbstractComponent id="root">` which can author children, which can author their own children. The authoring queue ensures builds don't overlap. Subsequent page loads render all components from IDB cache (zero authoring latency).

17. **v1 legacy removal** -- DONE. Removed: `state.ts`, `seeds.ts`, `seed-main.ts`, `seed-agent.ts`, `seed-agent-mount.ts`, `seed-use-agent-state.ts`. Cleaned: `types.ts` (removed StateStore, AgentMemory, ThinkResult, ComposeResult, ConversationMessage, StateMeta; simplified Runtime interface), `prompts.ts` (removed buildThinkPrompt/Evolve/Compose), `runtime.ts` (removed think/evolve/compose/_callLLM/reason methods and stateStore dependency), `ctxl.ts` (removed v1 exports, made `create()` use v2 seeds by default), `boot.ts` (removed v1 state store, seed detection, simplified to v2-only), `global.d.ts` (removed __AGENT_STATE__). Total: ~500 LOC removed across 6 deleted files and 6 cleaned files.

**Milestone:** The system supports recursive self-decomposition. Components author children by rendering `<AbstractComponent>`. Shared atoms coordinate state across the tree. Builds are serialised to prevent race conditions. v1 legacy has been fully removed -- the codebase is now v2-canonical.

### Phase 4: Robustness -- IMPLEMENTED

**Production hardening.**

18. **Shape change detection refinement** -- DONE. Shape comparison now tracks key names + value types (not just key names), tool schemas (not just tool names), and handler names. Added `reshapeCounters` -- per-component freshness tracking that counts `__reshape` requests since last authoring. Warns when a component requests 3+ reshapes, indicating stale guidelines or mismatched authoring. Counter resets on successful re-authoring.

19. **Inspection context** -- DONE. The `useReasoning` system context now automatically includes: (a) shared atom state -- all atom keys and current values, (b) sibling component IDs from the registry. This gives the reasoning LLM on-demand visibility into shared state and the component tree without polluting the authoring prompt. The LLM sees what it needs for reasoning decisions without the component author having to manually wire it.

20. **Dev harness: Inspect tab** -- DONE. Added a new "Inspect" view tab (alongside Component and About) with three live-updating sections:
    - **Components**: lists all authored components by ID with VFS path and line count
    - **Atoms**: shows all shared state atoms with current values (truncated for large values)
    - **Mutation Log**: reverse-chronological log of all mutations (authoring, reshape, rollback) with timestamps and outcomes. Rollback entries are visually distinct.
    The panel auto-refreshes every 2 seconds while visible. Purely observational -- the harness reads globals but never writes to them.

**Milestone:** The system handles edge cases: type-aware shape detection catches more structural changes, freshness tracking detects stale authoring, and the Inspect tab provides full runtime visibility into the component tree, shared state, and mutation history.

---

## 16. Architecture After v1 Removal

The codebase is now v2-canonical. No v1 code remains. The full system:

**Build infrastructure** (the genuinely novel layer):
- **VFS + IDB** -- source persistence
- **esbuild-wasm + VFS plugin** -- in-browser compilation
- **React Refresh injection** -- state-preserving hot swaps

**Host-side runtime:**
- **runtime.ts** -- build pipeline, LLM bridge, authoring prompt, registry regeneration
- **llm.ts** -- unified LLM transport (anthropic direct / proxy)
- **atoms.ts** -- scoped external state with IDB persistence

**VFS seeds** (real .ts/.tsx files under `src/seeds/`, imported via Vite's `?raw` suffix, compiled in-browser by esbuild):
- **seeds/ctxl/hooks.ts** -- `useReasoning` (delta-driven perception + multi-turn agent loop + ToolContext integration + inspection context) + `useAtom` (shared state) + `ToolContext` (React Context for parent tool injection)
- **seeds/ctxl/abstract-component.tsx** -- identity resolution, ToolContext.Provider, tool-based authoring (`write_component`), handlers prop forwarding, mutation history, error boundary + rollback, authoring queue, shape change detection (inputs + tools + handlers), freshness tracking
- **seeds/main.tsx** -- renders root `<AbstractComponent>`
- **seeds/ac/_registry.ts** -- auto-generated component registry

The system gets simpler by aligning with React instead of building alongside it.

---

## 17. Connection to Contextual

The infinite canvas of Contextual is a component tree. Each context element is an `<AbstractComponent>` with:

- **inputs** -- the data this element works with
- **tools** -- the actions available in this context
- **report** -- how it communicates findings to the orchestrating layer

The decomposition Contextual performs -- breaking objectives into manipulable elements -- is recursive self-decomposition. The root AbstractComponent reasons about the objective and renders children. Each child reasons about its piece. The canvas *is* the component tree. The elements *are* the components.

The difference from v1's vision: composition is native to React now, not mediated by a special API. The tree grows by rendering, not by file generation. This is what React was always designed for.

---

## 18. Philosophical Note

The question hasn't changed: what happens when a component has opinions about its own source code?

But the framing has. v1 built a parallel system for agency and stapled it to React. v2 recognises that React already *is* an agent framework -- it just didn't have an LLM in the assess step.

`useReasoning` is not a new concept. It's `useEffect` with an LLM instead of a side effect. The component perceives a change, reasons about it, and the result flows back into state and render. That's React's cycle. That's the agent's cycle. They were always the same cycle.

The only genuinely new thing is the build infrastructure: a component that can rewrite its own source and survive. That's the one thing React can't do natively. Everything else -- perception, reasoning, tools, composition, state -- is React, made intelligent.

We aren't building an agent system that happens to use React. We're building React components that happen to be intelligent.
