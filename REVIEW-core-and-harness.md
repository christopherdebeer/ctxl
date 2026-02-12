# Core & Harness Review

**Implementation against vision. What's lean, what's not, and where the harness should get out of the way.**

v0.1 -- February 2026

---

## The Lean Core

The actual irreducible core of ctxl is remarkably small. Strip away the dev UI, the build plumbing, the seed templates, and what remains is five concepts that fit on a napkin:

| Concept | Implementation | LOC |
|---------|---------------|-----|
| State store | `state.ts` | 29 |
| Persistence | `idb.ts` | 56 |
| Refresh injection | `refresh.ts` | 37 |
| VFS resolution | `vfs-plugin.ts` | 65 |
| LLM prompts | `prompts.ts` | 144 |

**Total: ~330 lines.** These five modules have zero coupling to the dev UI, zero coupling to DOM elements, and minimal coupling to each other. They are the primitives. Everything else is orchestration.

The state store is 29 lines and it's exactly right. Immutable updates, pub/sub, `useSyncExternalStore`-compatible. Nothing to cut.

The IDB wrapper is 56 lines of IndexedDB ceremony that can't be avoided. Clean.

The refresh injector is 37 lines of elegant regex. It does one thing, correctly.

The VFS plugin is 65 lines. The 8-candidate resolution strategy (`.ts`, `.tsx`, `.js`, `.jsx`, plus `index.*` variants) is slightly overgeneralized for a system that currently has 4 files, all with explicit extensions. But it costs nothing at runtime and handles the general case for when agents create new files. Leave it.

The prompts module is 144 lines across three functions. This is the one place in the core that could be leaner -- the three prompts share significant structure. But they're strings, not logic, and duplication in strings is often clearer than abstraction. This is fine.

### What's conspicuously NOT in the core

The `runtime.ts` factory at 447 lines is the biggest single file, and it's doing too many jobs. It currently houses:

1. **LLM transport** (`_callLLM`, `think`, `evolve`, `compose`) -- ~230 lines
2. **Build pipeline** (`buildBundle`, `importBundle`, `buildAndRun`) -- ~50 lines
3. **File patching** (`applyPatch`) -- ~15 lines
4. **Lifecycle** (`initRefresh`, `initEsbuild`, `reset`, `runDisposers`) -- ~40 lines
5. **Config persistence** (`saveConfig`) -- ~5 lines
6. **UI callbacks plumbing** (destructuring `callbacks`, calling `onStatus`/`onMode`/etc.) -- woven throughout

Items 2-4 are genuine core. Item 1 is the brain. Item 5-6 are harness leaking in.

---

## Where the Harness Gets in the Way

### 1. `runtime.ts` is the harness/core seam, and it's blurred

The runtime factory takes a `callbacks` bag (`onStatus`, `onMode`, `onFileChange`, `onBuildStart`, `onBuildEnd`, `onError`) and weaves them into core operations. Every `buildAndRun` call does:

```ts
onMode("building", "warn");
onStatus(`Building (${reason})...`);
onBuildStart();
// ... actual work ...
onMode("running", "");
onStatus(`Build #${buildCounter} running. (${ms}ms)`);
onBuildEnd(buildCounter, ms);
```

These status updates are dev UI concerns. The build pipeline shouldn't know or care about pills and status bars. The runtime should emit events or return results; the harness should interpret them.

**Recommended split:** The build pipeline should be a pure function: files in, bundle out. The runtime wraps it with lifecycle. The boot/UI layer wraps *that* with status reporting. Three layers, each minding its own business.

### 2. `think()` duplicates `_callLLM()` instead of using it

`_callLLM()` is a clean 50-line function for making Anthropic API calls. Then `think()` (~175 lines) rebuilds the entire fetch logic from scratch because it needs `tools` and `tool_choice` in the request body. The two functions share identical:
- Config reading (`apiMode`, `apiKey`, `proxyUrl`, `model`)
- Fetch construction for both `"anthropic"` and `"proxy"` modes
- Error handling patterns
- Response parsing scaffolding

The only difference: `think()` adds `tools` and `tool_choice` to the body and extracts a `tool_use` block from the response.

**Recommended:** `_callLLM` should accept an optional `extras` parameter for additional body fields, and return the raw API response. Let `think()` and `evolve()` interpret the response shape themselves. This cuts ~80 lines and eliminates a maintenance hazard (update one fetch path, forget the other).

### 3. `boot.ts` is a 294-line procedural script with 17 DOM references

`boot.ts` is the dev environment. It's doing its job. But it's doing it as a single procedural script with mutable module-level state (`activePath`, `aboutLoaded`, `files`, `idb`, `runtime`) and 17 `getElementById` calls at the top.

This isn't a problem for the dev harness -- it works, and it doesn't leak into the core. But it's worth noting: the dev harness is bigger than the entire core (294 vs ~330 lines), and any new feature (multi-file tabs, diff view, mutation timeline) will inflate it further.

If the dev UI is meant to be temporary scaffolding, it doesn't matter. If it's meant to grow, it needs structure. The `callbacks` pattern in `createRuntime` is the right direction -- the harness talks to the core through a clean interface. But the harness itself has no internal structure.

### 4. Seed files as code-generating-code

The `seed-*.ts` files use a `const L = []; const o = (s) => L.push(s)` pattern to build source strings line-by-line. This is ~570 lines across 4 files (seed-agent-mount, seed-agent, seed-use-agent-state, seed-main).

The pattern exists to avoid template literal escaping issues. It works. But it makes every seed file unreadable at a glance -- you can't scan the agent's source code, you scan function calls that produce the agent's source code. Syntax highlighting is lost. Refactoring is error-prone. Grep doesn't work naturally.

`seed-main.ts` uses a plain template literal and is immediately readable. The others should too. Template literal escaping (`\${...}` for literal template expressions in the output) is a minor cost for major readability gain.

**Exception:** `seed-agent.ts` has genuinely complex string interpolation (styled-component template literals inside a template literal). This is the one place where the `o()` pattern pays for itself. Consider: keep `o()` for `seed-agent.ts` only, convert the others to template literals.

### 5. `compose()` has an `import`-sniffing heuristic

```ts
if (source.startsWith("import ")) {
  files.set(path, source);
  // ...
}
```

This is a code smell from the original `reason()` approach (the design review's "Reading A" critique). The compose function strips markdown fences, then checks if the result starts with `import`. If the LLM returns valid code that starts with a comment, a type declaration, or a `const`, it's rejected.

The system prompt says "Just the code starting with imports" but the validation should be: "does esbuild compile this successfully?" Not "does it start with the right substring." The build pipeline already validates syntax -- use it.

### 6. The `disposers` array is unused

`runtime.ts:42` declares `disposers: []`, and `runDisposers()` pops and calls them. But nothing in the codebase ever pushes to `disposers`. The vision doc (section 5.4) describes the dispose protocol for cleaning up intervals and listeners between rebuilds, but it's not wired up.

This is either dead code or an incomplete feature. If it's the latter, it should be documented as such. If it's the former, cut it.

### 7. The `reason()` legacy alias should go

```ts
async reason(prompt, agentPath) {
  return this.evolve(prompt, agentPath);
}
```

The design review correctly identified that `reason()` was the old conflated API. It's been split into `think()` and `evolve()`. The alias exists for backward compatibility, but the only consumer is internal (seed components), and those have already been updated. Ship the breaking change.

---

## Implementation vs. Vision: Status Check

The design review (`agent-as-component-review.md`) identified a critical gap: the implementation was "Reading A" (agent as author -- exists only at mutation time) when the vision demands "Reading B" (agent as inhabitant -- lives continuously in the component).

**The current implementation has closed most of this gap.** The think/evolve split is implemented and working:

| Capability | Vision Doc | Implementation | Status |
|-----------|-----------|---------------|--------|
| Think (in-component reasoning) | Section 7.1 | `runtime.think()` with tool_use | Done |
| Evolve (self-modification) | Section 8 | `runtime.evolve()` + `applyPatch` | Done |
| Compose (child spawning) | Section 12 | `runtime.compose()` | Done |
| Multi-turn conversation | Section 7.3 | History reconstruction in `think()` | Done |
| Structured responses | Section 4.1 of review | `ThinkResult` with tool_use | Done |
| `useAgentSelf` composability | Section 8.2 of review | Implemented in seed-use-agent-state | Done |
| Error boundary | Section 6 | `AgentErrorBoundary` class | Done |
| Agent Toolbar (immune layer) | Section 3, Layer 1 | `AgentToolbar` in seed-agent-mount | Done |
| External state survives mutations | Section 5.3 | `createStateStore` with immutable updates | Done |

What remains unrealized from the vision:

| Gap | Vision Reference | Notes |
|-----|-----------------|-------|
| Settling protocol | Section 7.2 | No `lastReasoningCause` tracking. Infinite loop prevention is left to the agent's own logic. |
| Mutation history with rollback | Section 8.2, 8.4 | `meta.mutations` records events but stores no `previousSource`. No rollback mechanism. |
| Validation gate (smoke render) | Section 8.3 | Only esbuild compilation validates. No test render in detached root. |
| Hook-signature tracking | Section 6.1 | Still regex-only. Acknowledged as Phase 4. |
| Multi-agent ecology | Section 12 | Single `AgentMount`. Acknowledged as Phase 5. |
| Auto-recovery from hook violations | Section 8.5 | Error boundary shows error + retry button but doesn't auto-rollback after N crashes. |

### The biggest remaining gap: Settling

The vision doc's section 7.2 describes a settling protocol that distinguishes external triggers, self-caused triggers, and explicit triggers. This is not implemented. Currently:

- `think()` returns a result and the component decides what to do with it (good)
- `evolve()` triggers `applyPatch` which triggers `buildAndRun` (good)
- But nothing prevents: think result -> state update -> re-render -> agent logic calls think again -> infinite loop

The seed agent avoids this through UI gating (the `busy` flag disables inputs). But an agent that uses `useEffect` to trigger reasoning on state changes has no architectural protection against runaway loops. The settling protocol is the missing immune system for the reasoning loop.

### The second gap: No rollback

The mutation log (`meta.mutations`) records `{ timestamp, reason, path }` but not `previousSource`. If a mutation breaks something, the only recovery is the error boundary's retry button (which re-renders the broken code) or manual reset. The vision doc describes multi-level rollback via stored `previousSource` -- this would be a small but high-value addition.

---

## The Actual Dependency Graph

What depends on what, and where the seams should be:

```
                 ┌──────────────────────────────────┐
                 │            boot.ts                │
                 │         (dev harness)             │
                 │  17 DOM refs, file editor,        │
                 │  settings UI, keyboard shortcuts  │
                 └──────────┬───────────────────────┘
                            │ callbacks bag
                            v
                 ┌──────────────────────────────────┐
                 │          runtime.ts               │
                 │    (orchestration + LLM brain)    │
                 │                                   │
                 │  _callLLM ←── think, evolve,      │
                 │                compose             │
                 │  buildBundle ← buildAndRun         │
                 │  applyPatch                        │
                 │  initRefresh, initEsbuild          │
                 └──┬────┬────┬────┬────────────────┘
                    │    │    │    │
          ┌─────┘    │    │    └──────────┐
          v          v    v               v
    prompts.ts   vfs-plugin.ts  refresh.ts  idb.ts
    (LLM framing)  (esbuild     (injection)  (persistence)
                    resolver)
                                              state.ts
                                              (pub/sub store)
```

The **clean seam** is between `boot.ts` and `runtime.ts`. The callbacks interface is the right abstraction. The dev harness stays out of the core's way through this boundary.

The **messy seam** is inside `runtime.ts`, where LLM transport logic (API modes, fetch headers, tool definitions, response parsing) is entangled with build pipeline logic (esbuild invocation, blob URLs, React Refresh timing). These are genuinely different concerns that happen to share a namespace.

---

## Concrete Recommendations

### Do now (high value, low effort)

1. **Extract `_callLLM` into a shared transport.** Make it accept optional extra body fields so `think()` can add `tools`/`tool_choice` without duplicating the fetch logic. Cuts ~80 lines.

2. **Store `previousSource` in mutation log.** One line change in `useAgentSelf`'s `evolve()`: capture `window.__RUNTIME__.files.get(filePath)` before applying the patch. Enables future rollback.

3. **Remove `reason()` alias.** It's dead weight from the pre-split API.

4. **Convert `seed-agent-mount.ts` and `seed-use-agent-state.ts` to template literals.** They don't have the nested-template-literal problem that `seed-agent.ts` has.

### Do next (structural)

5. **Split `runtime.ts` into two modules:**
   - `llm.ts` -- transport, think, evolve, compose. Pure functions that take config and return results.
   - `runtime.ts` -- build pipeline, file patching, lifecycle. Uses `llm.ts` for brain functions.

   This makes the LLM layer testable independently from the build system.

6. **Implement settling protocol.** A `lastReasoningCause` ref in the mount layer that tracks whether re-renders are self-caused or externally triggered. Without this, any agent that reasons in `useEffect` will burn API credits in an infinite loop.

7. **Replace `import`-sniffing in `compose()`.** Try to compile the output instead of checking `source.startsWith("import ")`. The build pipeline already exists for this.

### Do later (polish)

8. **Add basic rollback.** Use the stored `previousSource` (from recommendation 2) to implement a "revert last mutation" button in the error boundary.

9. **Wire up disposers** or remove them. Currently dead code.

10. **Extract boot.ts into smaller modules** if the dev UI is going to grow. If it's scaffolding that gets replaced, leave it.

---

## Summary

The core is genuinely lean: ~330 lines of well-separated primitives. The vision's think/evolve/compose split is implemented and working. The isomorphism table from the architecture doc is more than half realized.

The harness (runtime orchestration + dev UI) is ~740 lines and mostly stays out of the way, with two exceptions: the LLM transport is duplicated inside `runtime.ts`, and the callback plumbing leaks UI concerns into build operations. Both are fixable without rearchitecting.

The seed files total ~570 lines and are the least satisfying part of the codebase -- code generating code is inherently harder to read and maintain. The `o()` pattern is justified for `seed-agent.ts` (nested template literals) but not for the simpler seeds.

The biggest vision gaps are the settling protocol (no protection against runaway reasoning loops) and rollback (mutations are logged but not reversible). Neither requires architectural changes -- they're features that slot into the existing structure.

The core does what the vision says. The harness should get leaner, not by removing functionality, but by moving the seams: LLM transport out of the runtime, UI callbacks out of the build pipeline, and the settling protocol into the mount layer where it belongs.
