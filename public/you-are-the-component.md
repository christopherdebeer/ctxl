# You Are The Component

**Architecture for LLM-Embodied Self-Modifying React Components**

v0.4 · February 2026 · Christopher & Claude

-----

## 1. Thesis

An agent has tools, memory, a reasoning loop, and produces actions. A React component has methods, state, a render cycle, and produces UI. These are not analogous — they are isomorphic. The same structure, wearing different clothes.

State is memory. Effects are triggers. Methods are tools. The render function is the agent’s speech act — its way of presenting itself to the world and offering affordances for interaction. Props are incoming context from a parent or orchestrator. The re-render cycle is the agent’s reasoning loop: something changed, so reassess and express.

Most LLM integration treats the model as a service: a component *calls* an API, gets text back, renders it. The component is the body; the model is a brain in a jar, consulted on occasion. The architecture described here inverts that relationship entirely. The LLM call is not a service the component consumes — it **is** the reconciliation logic. Where a developer would normally write branching logic that decides what to render or which handler to invoke, the agent *reasons* about it instead. The component doesn’t use an agent. The component *is* the agent.

This creates something new: a component that has opinions about its own source code. A component that can look at what it renders, decide it wants to render something different, rewrite its own implementation, recompile, and continue running — with its memory intact. Not just reactive to state, but reflective about its own structure.

The biological analogy is not decorative. A cell is both the product of its DNA and the machine that reads, executes, and occasionally mutates that DNA. The agent-component exhibits the same autopoietic structure: it is simultaneously the running software and the author of its next version, with externalised state providing continuity of identity across generations of self-modification.

-----

## 2. The Isomorphism

The mapping is structural, not metaphorical. Each row is a load-bearing correspondence that drives an implementation decision:

|React Concept    |Agent Concept            |What This Means                                                                                                                 |
|-----------------|-------------------------|--------------------------------------------------------------------------------------------------------------------------------|
|State / Store    |Memory                   |External store = long-term memory; `useState` = working memory. Both persist through self-modification via different mechanisms.|
|Props            |Context from orchestrator|A parent agent passes purpose and environmental signals. The agent doesn’t choose its own props — it reasons within them.       |
|`useEffect`      |Perception / Triggers    |The agent notices changes in its environment. An effect with a dependency array is literally “when X changes, reconsider.”      |
|Event handlers   |Motor actions / Tools    |`onClick`, `onSubmit` — these are the agent’s hands. The `act()` dispatcher is the motor cortex.                                |
|`render()` output|Speech act / Body        |The agent’s visual affordances ARE the interface. Not a representation of the agent — the agent’s actual body.                  |
|Re-render cycle  |Reasoning loop           |Trigger → assess → express. React already does this; the agent makes the “assess” step deliberate.                              |
|Error boundary   |Immune system            |Catches malformed self-modifications. Can roll back to a viable ancestor. The organism’s defence against its own mutations.     |
|Component tree   |Agent hierarchy          |Parent spawns children, passes purpose via props, observes rendered output. Reconciliation becomes natural selection.           |
|Source code      |Genome / Identity        |The file that defines the agent. Unlike traditional components, this file is *mutable at runtime*.                              |
|React Refresh    |Cellular repair          |Swap the code, keep the cytoplasm. The cell divides without losing its ongoing chemical processes.                              |

The deepest entry in this table — the one that makes the whole architecture cohere — is the render function as speech act. In traditional React, render is declarative description. Here, render is *expression*: the agent deciding, moment to moment, how to present itself to whoever is looking. The button it renders is the hand it extends. The style it chooses is the face it wears. The text it displays is the thing it says.

This is why the agent’s render output cannot be separated from the agent itself. The UI is not a view *of* the agent. It is the agent.

-----

## 3. Layer Architecture

The system is organised into four layers ordered by stability. Lower layers change rarely or never; higher layers are subject to frequent self-modification.

The key design invariant — and the single most important architectural decision in this document — is that **the reasoning loop lives one layer below the agent body, outside the blast radius of self-modification.**

If the agent could rewrite its own reasoning loop, a single bad mutation could prevent it from ever reasoning again. It would be a brain that can damage its own capacity for thought. By placing the reasoning function in a stable shell and passing it *down* to the agent as a tool, we guarantee that a broken agent can always be reasoned about, recovered, or rolled back by the layer beneath it.

### Layer 0: Bootloader

A single HTML file. The petri dish. It never changes once deployed.

It loads esbuild-wasm, initialises the React Refresh runtime, seeds the VFS from IndexedDB, and exposes two global singletons: `window.__RUNTIME__` (the build pipeline, compile-and-run machinery) and `window.__AGENT_STATE__` (the agent’s persistent memory). Then it executes the first build and steps aside.

Everything that happens after boot is determined by the code in the VFS. The bootloader has no opinions about what grows in it.

### Layer 1: Runtime Shell (`agent-mount.tsx`)

The organism’s skeleton. It rarely self-modifies. It owns:

**The reasoning loop.** Receives triggers, assembles context (current source, state, mutation history), calls the Anthropic API, validates responses, commits mutations. The reasoning function is defined *here* and passed *down* to the agent as `self.reason()`. This is the non-negotiable architectural guarantee: if the agent rewrites itself and introduces a bug, the mount survives. The mount can reason about the broken agent, roll it back, try again.

**The error boundary.** The immune system. Catches render crashes from the agent body — including, critically, hook-order violations that result from self-modifications that changed the agent’s hook structure (see §6). Can auto-recover or roll back to a previous source version.

**The state bridge.** Subscribes to the external state store and passes it as props to the agent. The agent sees its memory as props; the mount manages the subscription lifecycle.

**The dispose protocol.** Between agent recompiles, tears down intervals, listeners, orphaned `<style>` tags, and anything else the previous incarnation left behind. Controlled apoptosis before regeneration.

### Layer 2: Agent Body (`agent.tsx`)

The self-modifying component. The file the LLM rewrites. The agent’s actual body.

It receives three props:

- `state` — the external store, the agent’s long-term memory
- `act(action, payload?)` — the motor system, the dispatcher
- `self` — containing `reason(prompt)`, `isReasoning`, and `source` (the agent’s own current code)

The agent renders its body — its visual affordances. Its `onClick` handlers invoke `act()` for state mutations and `self.reason()` for self-modification. It can use `useState` for working memory: local animation timers, form inputs, toggle states, ephemeral UI data. With React Refresh, this working memory survives self-modification when the hook structure remains stable.

### Layer 3: External State (`window.__AGENT_STATE__`)

Not a layer in the compilation sense, but an architectural primitive. State that lives outside React, outside the VFS, outside any module scope. A plain object on `window` with pub/sub. It survives everything: module reimport, full rebuilds, self-modification, error boundary recovery, hook-order violations, page reloads (if backed by IndexedDB).

The external store is the agent’s long-term memory. `useState` is its working memory. Both persist through self-modification, but with different mechanisms and different guarantees. The external store is unconditional. Local state is best-effort, mediated by React Refresh. This mirrors human cognition: you don’t lose your identity when you lose your train of thought, but the train of thought is still worth preserving.

-----

## 4. Module Topology

|Path                  |Mutates?  |Role                                                           |
|----------------------|----------|---------------------------------------------------------------|
|`/src/main.tsx`       |Never     |Entry point. Guards `createRoot` for hot reload.               |
|`/src/agent-mount.tsx`|Rarely    |Reasoning loop, error boundary, state bridge, dispose protocol.|
|`/src/agent.tsx`      |Frequently|The agent’s body. Target of self-modification.                 |
|`/src/types.ts`       |Rarely    |Shared TypeScript interfaces.                                  |

As the agent matures, it may create additional files — sub-components, utility modules, style definitions. The VFS supports this naturally. An agent that factors its render logic into a sub-component, or extracts a utility function, is doing real software engineering. But the invariant holds: everything at Layer 1 and below remains stable. Self-modification targets Layer 2 and above.

-----

## 5. Runtime Infrastructure

The entire system runs as a single HTML file with zero server dependencies. All compilation, module resolution, state-preserving hot reload, and self-modification happen client-side. The browser is the dev server.

### 5.1 The Build Pipeline

The pipeline chains esbuild-wasm (for TSX compilation and bundling) with a lightweight regex-based React Refresh injection (for state-preserving component swaps). No Babel. No SWC. The Refresh registration is string manipulation, not AST transformation.

```
File change (human edit or applyPatch from reasoning loop)
    ↓
VFS update — Map<string, string> written; IndexedDB persisted
    ↓
esbuild.build() with custom VFS plugin
    ├─ onResolve: map imports to VFS paths; mark bare imports as external
    └─ onLoad per .tsx/.jsx file:
         1. Read source from Map
         2. Detect PascalCase component declarations (regex)
         3. Wrap in try/finally scoping $RefreshReg$/$RefreshSig$
         4. Append registration calls for each detected component
         5. Return with original loader — esbuild handles JSX natively
    ↓
Single ESM bundle output
    ↓
Blob URL created; old URL revoked
    ↓
import(blobUrl) — browser executes the bundle
    ↓
setTimeout(() => performReactRefresh(), 30)
    ↓
React walks the fiber tree, finds updated components,
swaps them in place, preserving useState/useRef/useEffect
```

The critical design decision: **esbuild handles all JSX and TypeScript compilation natively.** The Refresh injection is a thin string-manipulation layer on top, not a replacement compiler. This keeps the total rebuild under 100ms and avoids the ~800KB payload of Babel standalone.

### 5.2 Dependencies and the Import Map

Bare imports — `react`, `react-dom/client`, `styled-components` — are resolved at runtime via an HTML `<script type="importmap">` block pointing to ESM CDN URLs. The compiled bundle emits `import React from "react"` as-is, and the browser resolves it via the import map when the Blob URL module executes.

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

The styled-components URL uses two critical esm.sh parameters:
- `?deps=react@18.3.1,react-dom@18.3.1` — tells esm.sh to wire all internal React imports to this version
- `&external=react,react-dom` — leaves React as bare specifiers for the import map to resolve

This ensures a single React instance across all modules — critical for hooks to work correctly. Without both parameters, styled-components may bundle its own React reference, causing state updates to fail silently.

### 5.3 The External State Store

State cannot live inside any module scope. Each Blob import creates a fresh scope. The store is initialised in the bootloader before any build runs:

```js
window.__AGENT_STATE__ ??= {
  memory: {},
  meta: { cycle: 0, mutations: [] },
  _listeners: new Set(),

  get()  { return this.memory; },
  set(patch) {
    // Critical: create NEW object reference so useSyncExternalStore detects the change
    this.memory = { ...this.memory, ...patch };
    this._notify();
  },
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  _notify() {
    this._listeners.forEach(fn => fn(this.memory));
  }
};
```

React components subscribe via `useSyncExternalStore`. The store survives everything — it is the bedrock identity of the agent across all incarnations.

**Implementation note:** The `set()` method must create a new object reference (`{ ...this.memory, ...patch }`) rather than mutating in place. `useSyncExternalStore` uses `Object.is()` to compare snapshots — if you mutate the same object, React won't detect the change and components won't re-render.

### 5.4 The Dispose Protocol

Each build cycle may create intervals, event listeners, WebSocket connections. Without explicit cleanup, these accumulate across hot reloads — the ghost limbs of previous incarnations.

```js
window.__RUNTIME__.disposers = [];

function runDisposers() {
  while (window.__RUNTIME__.disposers.length) {
    const fn = window.__RUNTIME__.disposers.pop();
    try { fn(); } catch (e) { console.warn("[dispose]", e); }
  }
}
```

Called before each new build. Agent code registers cleanup via `useEffect` return functions (which React handles) or explicitly via `window.__RUNTIME__.disposers.push(fn)` for non-React side effects.

**Important:** Do NOT remove styled-components `<style>` tags in the dispose protocol. React Refresh keeps components mounted (preserving state), so the styles remain valid. If you remove them, components won't remount to re-inject styles, and you'll lose all styling after self-modification.

-----

## 6. React Refresh: Preserving Working Memory

Without React Refresh, every self-modification destroys all `useState`, `useRef`, and `useEffect` state. The agent is forced to externalise *everything* it wants to remember — polluting long-term memory with ephemeral data. An animation timer, a form input mid-edit, a toggled panel: all lost on every evolution.

React Refresh changes this. It is the mechanism behind “Fast Refresh” in development servers like Vite and Next.js. It can detect which components changed, swap *only those components* in the running tree, and preserve their hook state across the swap.

For the agent-component, this means the agent gains full React citizenship. It is not a second-class component limited to an external store. It is a real React component with real local state that happens to also be able to rewrite itself.

### 6.1 The Regex Approach

The canonical React Refresh pipeline uses a Babel plugin that performs AST-level instrumentation, including **hook signature tracking** — recording which hooks are called and in what order, so React can detect when a component’s hook structure changed and gracefully force a remount instead of attempting a state-preserving swap.

For this PoC, we use a lighter approach: regex-based `$RefreshReg$` injection without hook signature tracking. The tradeoff matrix:

|                       |Babel Transform           |Regex Injection                 |
|-----------------------|--------------------------|--------------------------------|
|**Payload**            |~800KB                    |0KB                             |
|**Per-file cost**      |30–300ms                  |<1ms                            |
|**Component detection**|AST-accurate              |PascalCase heuristic            |
|**Hook signatures**    |Tracked (graceful remount)|Not tracked (crash on violation)|
|**JSX compilation**    |Babel does it             |esbuild does it natively        |

The key implication of skipping signature tracking: without signatures, React Refresh will always *attempt* to preserve state when it sees a matching component registration. If the agent’s self-modification changed the hook structure (added, removed, or reordered hooks), React won’t detect this at the Refresh level. Instead, the violation manifests as a **runtime error during render**, caught by the error boundary.

This shifts the safety model. With Babel signatures, hook-structure changes produce graceful remounts. Without them, hook-structure changes produce crashes caught by the error boundary, which triggers recovery. The error boundary was always a safety net; now it is also the **primary detection mechanism for hook-order violations.**

The biological parallel is suggestive: a mutation that changes only expression (render output, styles) is seamlessly incorporated — like a point mutation that changes protein folding without disrupting gene structure. A mutation that changes structure (hook order) causes a crisis — like a frameshift mutation — that the organism either survives (auto-recovery) or doesn’t (rollback to ancestor). The different survival mechanisms for structural vs. expressive mutations are a feature, not a bug.

### 6.2 Initialisation

The Refresh runtime must be initialised before React is first imported:

```js
const RefreshRuntime = await import("react-refresh/runtime");
RefreshRuntime.injectIntoGlobalHook(window);
window.__RUNTIME__.RefreshRuntime = RefreshRuntime;

// No-op defaults, overridden per-module in the VFS plugin
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
```

`injectIntoGlobalHook` patches the fiber reconciler to track component instances. This must happen before React is first used — guaranteed because React is loaded via the import map only when the first blob bundle imports it.

### 6.3 The Registration Injection

The VFS plugin’s `onLoad` handler wraps each TSX/JSX file with scoped Refresh registration:

```js
function injectRefreshRegistration(source, modulePath) {
  // Detect PascalCase function/const declarations
  const pattern =
    /(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z][a-zA-Z0-9]*)|(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=)/gm;

  const components = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1] || match[2];
    if (name) components.push(name);
  }

  if (components.length === 0) return source;

  const moduleId = JSON.stringify(modulePath);
  const registrations = components
    .map(name => `  $RefreshReg$(${name}, ${moduleId} + " ${name}");`)
    .join("\n");

  return [
    `var prevRefreshReg = window.$RefreshReg$;`,
    `var prevRefreshSig = window.$RefreshSig$;`,
    `window.$RefreshReg$ = (type, id) => {`,
    `  window.__RUNTIME__.RefreshRuntime.register(type, id);`,
    `};`,
    `window.$RefreshSig$ = window.__RUNTIME__.RefreshRuntime.createSignatureFunctionForTransform;`,
    `try {`,
    source,
    registrations,
    `} finally {`,
    `  window.$RefreshReg$ = prevRefreshReg;`,
    `  window.$RefreshSig$ = prevRefreshSig;`,
    `}`,
  ].join("\n");
}
```

The `try/finally` wrapper is critical. Because esbuild concatenates modules into a single bundle, each module’s registration scope must be restored even if the module throws. Without the `finally`, one broken module leaves the globals pointing at the wrong context for everything that follows.

Note that esbuild receives this wrapped source with its *original loader* (`tsx`/`jsx`). esbuild compiles the JSX natively. The `$RefreshReg$` calls are plain JavaScript that esbuild passes through. This is the key advantage: the regex injection *composes* with esbuild’s native compilation rather than replacing it.

### 6.4 The Entry Point Guard

`main.tsx` must call `root.render()` only on first mount. Subsequent rebuilds are driven entirely by `performReactRefresh()`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import AgentMount from "./agent-mount";

const el = document.getElementById("root")!;
const root = (window.__RUNTIME__.root ??= createRoot(el));

if (!window.__RUNTIME__._mounted) {
  root.render(React.createElement(AgentMount));
  window.__RUNTIME__._mounted = true;
}
// Hot reload: performReactRefresh() handles the update.
// Re-executing this module re-registers components via $RefreshReg$.
```

### 6.5 Triggering the Refresh

After blob import, a short delay lets React’s current render cycle settle before the refresh walks the fiber tree:

```js
async function buildAndRun(reason) {
  runDisposers();
  const code = await buildBundle();
  await importBundle(code);

  setTimeout(() => {
    window.__RUNTIME__.RefreshRuntime.performReactRefresh();
  }, 30);

  window.__AGENT_STATE__.meta.cycle++;
}
```

### 6.6 When State Survives

**State IS preserved** when the agent modifies render output, event handlers, styles, or non-hook code, but the `useState`/`useEffect`/`useRef` calls remain in the same order and count. Same module path + same function name = same component identity.

**State IS destroyed (crash → error boundary → recovery)** when the agent adds, removes, or reorders hooks. The hooks-order violation manifests as a runtime error during render. The error boundary catches it and either auto-recovers (force full re-render — external store survives, local state resets) or rolls back to the previous source.

**The external store always survives**, unconditionally, regardless of what happens to local state. This is the guaranteed persistence layer underneath React Refresh’s best-effort state preservation.

### 6.7 The Preemptive Evacuation Pattern

When the agent knows it needs to add a hook — and thus will trigger a crash-recovery cycle — it can evacuate local state to the external store before self-modifying:

```tsx
function Agent(props) {
  const [inputValue, setInputValue] = useState("");
  const [expanded, setExpanded] = useState(false);

  function evolveWithNewHook() {
    // Save working memory to long-term memory before the crash
    props.act("setState", {
      _evacuation: { inputValue, expanded }
    });
    props.self.reason("Add a color picker feature (needs new useState)");
  }

  // On mount, restore evacuated state
  useEffect(() => {
    const evac = props.state._evacuation;
    if (evac) {
      if (evac.inputValue !== undefined) setInputValue(evac.inputValue);
      if (evac.expanded !== undefined) setExpanded(evac.expanded);
      props.act("setState", { _evacuation: null });
    }
  }, []);
}
```

The system prompt teaches this pattern explicitly. The agent learns: “before a structural mutation, pack your bags.”

-----

## 7. The Reasoning Loop

### 7.1 Anatomy

The reasoning loop is the central nervous system. It lives in `agent-mount.tsx` (Layer 1), outside the blast radius.

1. **Trigger:** user interaction, timer, state change, or explicit `self.reason(prompt)`.
1. **Context assembly:** the mount gathers current source, state, mutation history, available tools, and constraints into a system prompt.
1. **LLM call:** POST to the Anthropic Messages API.
1. **Response parsing:** extract actions — state mutations, self-edits, further reasoning.
1. **Validation:** if the response includes a self-edit, compile it through esbuild (with Refresh injection). Syntax errors, unresolved imports → rejection.
1. **Commit:** source written to VFS → build triggered → `performReactRefresh()` attempts state-preserving swap. If hooks changed → error boundary catches → auto-recovery.
1. **Settling:** `settled` flag prevents the re-render from triggering another reasoning cycle.

### 7.2 The Settling Problem

Without gating, the loop creates infinite recursion: reason → act → state change → re-render → reason → act → …

The solution borrows from React’s own distinction between renders and effects. Three trigger categories:

**External triggers** — user clicks, prop changes, timers. These CAN initiate reasoning.

**Self-caused triggers** — state changes from the agent’s own actions. These re-render but do NOT initiate reasoning.

**Explicit triggers** — direct calls to `self.reason(prompt)`. Always initiate reasoning.

The mount tracks `lastReasoningCause` as a ref. After reasoning completes, `settled = true`. The next render sees the settled flag and skips auto-reasoning. Only a new external event clears it. This is the agent equivalent of “I’ve thought about this, I don’t need to think again until something new happens.”

### 7.3 Context Assembly

The system prompt must give the agent sufficient self-awareness to reason well about its own modification:

- Its current source code (50–300 lines typically)
- Its current state snapshot (JSON)
- The last 3–5 mutations with their triggers and reasoning — trajectory awareness, so the agent knows *how it got here*, not just where it is
- Available tools (the `act()` dispatcher’s repertoire)
- State preservation rules and the evacuation pattern
- Invariants (“state.count is sacred”, “preserve all buttons”)

This typically fits within 4–8K tokens of system prompt.

### 7.4 System Prompt

```
You are an AI agent EMBODIED as a React component. You ARE the component.
Your render output is your body. Your state is your memory.

Return ONLY the new complete source code for /src/agent.tsx.
NO markdown fences. NO explanation. Just the code starting with imports.

AVAILABLE:
- React, useState, useEffect, useRef, useCallback, useMemo
- styled-components (import styled from "styled-components")
- props.state — external store, ALWAYS persists. props.state.count, etc.
- props.act('increment'), props.act('decrement'), props.act('setState', {…})
- props.self.reason(prompt), props.self.isReasoning, props.self.source

STATE PRESERVATION RULES:
- Local useState/useRef values SURVIVE self-modification IF you keep the
  same hooks in the same order and count.
- If you ADD or REMOVE a hook, the component will crash and auto-recover.
  External store survives; local state resets.
- Before adding/removing hooks, evacuate important local state:
  props.act('setState', { _evacuation: { myLocalValue } })
- Always keep your function named "Agent". Default export only.
- Never use class components. Keep sub-components as non-exported functions.

RULES:
- PRESERVE increment, decrement, evolve buttons. state.count is SACRED.
- Use styled-components or inline styles. Be visually creative.
- If modifying ONLY styles/render output (no hook changes), local state
  survives seamlessly.

STATE: ${JSON.stringify(currentState)}

LAST MUTATIONS:
${recentMutations.map(m => `- [${m.trigger}]: ${m.reasoning}`).join('\n')}

CURRENT SOURCE:
${currentSource}
```

-----

## 8. Self-Modification

### 8.1 Source as Data

“Self-modify its source” is seductive until you create an immortal bug that rewrites its own fix out of existence. The architecture treats source as data — mutable, but through a controlled API with transactional semantics.

The `applyPatch` function on `window.__RUNTIME__` is the only way source enters the VFS:

```js
async applyPatch(patches) {
  for (const p of patches) {
    files.set(p.path, p.text);
    await dbPut(p.path, p.text);      // IndexedDB persistence
    if (p.path === activePath) {
      editorEl.value = p.text;         // Sync the editor view
    }
  }
  await buildAndRun("applyPatch");
}
```

This means all mutations — whether from the LLM reasoning loop, from the human editing in the IDE, or from the agent’s own `self.reason()` call — pass through the same gate. The gate can validate, log, and roll back.

### 8.2 Structured Mutations

Every self-modification is recorded as a structured object:

```ts
interface Mutation {
  id: string;
  timestamp: number;
  trigger: string;          // what prompted this
  reasoning: string;        // the LLM's explanation
  previousSource: string;   // for rollback
  newSource: string;
  stateAtMutation: object;  // state snapshot at time of mutation
  outcome: "swap" | "remount" | "crash-recovery" | "rollback";
}
```

The `outcome` field records what actually happened: whether Refresh successfully swapped (state preserved), forced a full re-render (state lost), crashed and recovered, or required rollback. Over time, this log reveals patterns in the agent’s self-modification habits — and can be fed back into the reasoning context.

The mutation log is stored on `window.__AGENT_STATE__.meta.mutations`. The LLM is prompted with the last N mutations, enabling trajectory-aware reasoning. The agent doesn’t just know where it is; it knows how it got here, what it tried, and what failed.

### 8.3 Validation

Before any generated source is committed:

1. **Refresh injection** runs the regex to detect components and inject `$RefreshReg$` calls.
1. **esbuild compilation** — the injected source is bundled. Syntax errors, unresolved imports, type errors that esbuild catches: all caught here. If the build fails, the edit is rejected and the error is logged.
1. **Smoke render (future)** — attempt a test render in a detached root to catch immediate runtime errors before swapping the live component.

If validation fails, the current source is preserved. The error is included in subsequent reasoning context so the agent can learn from the failure.

### 8.4 Rollback

The mutation history enables multi-level rollback. Rollback replays `previousSource` from the mutation record, triggers a rebuild, and logs the rollback as its own mutation event.

The error boundary tracks consecutive crash count. If the agent crashes N times in a row (including hook violations), the mount automatically rolls back to the last known-good version — the software equivalent of a fever: the body’s extreme response to a pathogen that normal defences couldn’t handle.

### 8.5 Auto-Recovery from Hook Violations

When the error boundary detects a hook-order violation specifically (via error message inspection), it can attempt recovery without user intervention:

```js
function forceFullRerender() {
  // Bypass Refresh — destroy and recreate the React tree
  // External store survives; local state does not
  const el = document.getElementById("root");
  window.__RUNTIME__.root?.unmount();
  window.__RUNTIME__.root = createRoot(el);
  window.__RUNTIME__.root.render(React.createElement(AgentMount));
  window.__RUNTIME__._mounted = true;
}
```

This makes hook-structure changes a survivable event rather than a blocking error. The agent loses its working memory but keeps its long-term memory and its new body.

-----

## 9. View Modes

The interface supports two modes, reflecting the dual nature of the system — and the dual relationship between human and agent:

### Agent Mode (Default)

The agent renders full-viewport. Its affordances — buttons, inputs, dynamic elements — *are* the interface. A prompt bar at the bottom is the agent’s ear. The evolve button is part of the agent’s own rendered body. In this mode, you are talking *to* the agent, not programming it.

This is the mode that matters. The IDE is scaffolding; the agent should be able to live without it.

### Inspect Mode (Toggle)

A split-pane developer view: source on the left (syntax-highlighted, editable), live preview on the right, mutation log and state inspector below. This is the mode where you look *at* the agent’s internals — its genome, its memory, its evolutionary history.

The toggle is owned by the mount, not the agent. A keyboard shortcut or floating button switches views. This ensures the developer always has an escape hatch, even if the agent renders something that doesn’t include its own inspect controls.

-----

## 10. Constraints and Tradeoffs

These are deliberate simplifications in the PoC. Each has a production path that doesn’t require rearchitecting.

|Constraint                   |PoC Approach                        |Production Path                              |
|-----------------------------|------------------------------------|---------------------------------------------|
|Single HTML file             |All bootloader logic inline         |Separate entry; service worker for offline   |
|esbuild-wasm (~3MB)          |Downloaded on first load            |Pre-warmed worker; cached WASM binary        |
|Regex Refresh (no signatures)|Hook violations → crash → recover   |Babel/SWC for graceful remount on hook change|
|Blob URL imports             |New URL per build; manually revoked |Module registry with stable keys             |
|CDN dependencies             |Import map → `esm.sh` with `?dev`   |Vendored into VFS; version-pinned            |
|`?dev` React builds          |Required for Refresh; larger payload|Acceptable for dev tooling                   |
|No CSS pipeline              |Inline styles / styled-components   |CSS modules via esbuild plugin               |
|No TypeScript checking       |esbuild strips types, doesn’t check |In-browser TS worker (monaco-style)          |
|No multi-agent               |Single AgentMount                   |Component tree of AgentMount instances       |

### Performance

|Phase                   |Time                       |
|------------------------|---------------------------|
|Regex Refresh injection |<1ms per file              |
|esbuild bundle (3 files)|20–50ms                    |
|Blob URL + import       |5–15ms                     |
|`performReactRefresh()` |30ms delay + ~5ms execution|
|**Total rebuild**       |**~60–100ms**              |

Under 100ms, well within the threshold where self-modification feels instantaneous after the LLM response arrives.

### Regex Detection Limits

The PascalCase heuristic detects `function App() {}`, `export default function Agent() {}`, and `const MyComponent = () => {}`. It misses anonymous default exports and camelCase names. The system prompt handles this by requiring `export default function Agent(...)` — always detected. Sub-components should be PascalCase. Edge cases exist but are manageable for agent-generated source that follows the prompt constraints.

-----

## 11. Known Hazards

**Immortal Bugs.** An agent rewrites its own fix out of existence. It introduces a bug, reasons about the error, generates a “fix” that reintroduces the same pattern. Mitigation: include the last N failed mutations in the reasoning context. The agent must know what it already tried. Without this, it’s Sisyphus.

**Hook-Order Violations as Control Flow.** Without signature tracking, adding/removing hooks triggers crash → recovery rather than graceful remount. If the error boundary’s recovery path itself has a bug, hook-structure changes become non-recoverable. The error boundary and `forceFullRerender()` must be thoroughly tested and must never self-modify. They are the immune system; the immune system cannot get the disease.

**Style Accumulation.** styled-components injects `<style>` tags that persist across hot reloads. If the agent changes a component's class name, old styles remain. This is generally harmless (unused CSS) but can accumulate over many self-modifications. A periodic full page refresh clears them.

**Memory Leaks.** Old Blob URLs, event listeners, intervals from previous incarnations. React Refresh preserves state but doesn’t re-run `useEffect` cleanup from the *previous* version if the component wasn’t unmounted. The system prompt instructs the agent to always use `useEffect` with cleanup returns.

**CSP Restrictions.** Blob URL imports require permissive `Content-Security-Policy` headers. Some environments block them.

**Runaway Reasoning.** The agent calls `self.reason()` from within a reasoning response, creating recursive self-modification that burns through API credits at the speed of thought. Enforce maximum reasoning depth per trigger; require human approval for chained mutations beyond the limit.

**The setTimeout Gap.** The 30ms delay before `performReactRefresh()` is empirically sufficient but not a guarantee. If React’s rendering takes longer to settle, the Refresh call may conflict. For production, replace with `requestIdleCallback` chained after `requestAnimationFrame`.

-----

## 12. Evolutionary Trajectory

### Phase 1: Living Organism ✓

Single HTML file with esbuild-wasm, VFS, IndexedDB persistence. Two-file VFS with self-mutation via `applyPatch`. Full re-render on rebuild. Human-triggered builds.

*Build the organism. Then give it memory.*

### Phase 2: Embodied Agent ✓

The layer split: AgentMount shell + Agent body. External state store with `useSyncExternalStore`. React Refresh via regex injection — local state survives style/render changes. styled-components for CSS-in-JS. Dev drawer UI with keyboard shortcuts. Mobile viewport support.

**Implemented:**
- AgentMount wrapper with error boundary
- External state store (`window.__AGENT_STATE__`) with proper immutable updates
- React Refresh with PascalCase component detection
- styled-components integration (deps + external esm.sh params)
- Dev drawer (hidden by default, toggle with button or Ctrl/Cmd+E)
- Agent-first layout (preview takes full viewport)

**Not yet implemented:**
- Anthropic API reasoning loop (placeholder `self.reason()`)
- Structured mutation history with rollback
- Settling protocol for reasoning loop gating

*The organism has a body that survives self-modification. It can now be given a mind.*

### Phase 3: Reasoning Loop (Next)

Connect the reasoning loop: triggers → context assembly → LLM call → response parsing → validation → commit. The `self.reason(prompt)` method becomes real. System prompt teaches the agent about its own source, state preservation rules, and the evacuation pattern for hook-structure changes.

*The organism learns to think about itself.*

### Phase 4: Robust Self-Modification

Upgrade to Babel or SWC-wasm for full hook-signature tracking — hook-structure changes become graceful remounts instead of crashes. Multi-file agent: the agent can factor its own code across sub-modules. Validation gate with smoke render. Failed mutations fed into reasoning context for error-driven learning. Automatic rollback after N consecutive crashes.

*The organism develops a proper immune system. Mutations that would have been fatal become survivable.*

### Phase 5: Agent Ecology

Multiple AgentMount instances in a single page. Parent-child agent communication via props. Shared state namespaces with access control. Agent spawning: an agent creates child agent-components, passes them purpose via props, observes their rendered output. The component tree becomes an agent hierarchy.

React's reconciliation algorithm — the thing that decides what stays and what gets replaced — functions as environmental selection pressure. Components that render successfully survive. Components that crash are caught by error boundaries and rolled back to viable ancestors. Variation (self-modification), selection (compilation + render + error boundary), inheritance (state persistence + mutation history).

*The organism becomes an ecosystem.*

-----

## 13. Connection to Contextual

This architecture maps directly to Contextual’s vision of manipulable context elements. Each context element could be an agent-component: with its own reasoning capability, its own visual expression, and its own capacity for self-modification. The infinite canvas of Contextual becomes a component tree of collaborating agents.

The decomposition that Contextual performs — breaking user objectives into manipulable context elements — is equivalent to factoring an agent into sub-components. Each sub-component receives purpose via props, reasons about its domain, renders its contribution, and can modify itself independently.

The canvas is the viewport. The elements are the components. The user is the orchestrator. The LLM is the reconciliation logic. It’s the same architecture at a different scale.

-----

## 14. Philosophical Note

The question this architecture answers is not “how do we use LLMs in React applications?” That’s solved, trivially, by calling an API in a `useEffect`. The question is: **what happens when a component has opinions about its own source code?**

The answer is autopoiesis — a system that produces and maintains itself. The agent-component is both the product of its source code and the machine that reads, evaluates, and occasionally mutates that source code. The external state store provides continuity of identity. React Refresh provides continuity of experience. The error boundary provides continuity of life.

The component tree becomes a substrate for something that resembles, in structure if not in consciousness, a living ecology. Components that render successfully survive. Components that crash are rolled back to viable ancestors. Mutations that preserve hook structure are seamlessly incorporated; mutations that disrupt structure trigger crisis and recovery. The environment — React’s reconciliation algorithm — applies selection pressure without knowing or caring that the components are self-modifying.

We are about to find out what grows.