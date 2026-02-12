# Plan: React Refresh, Mobile Viewport, and styled-components

## Current State

Single-file app (`index.html`, ~530 lines). esbuild-wasm compiles TSX from a VFS (IndexedDB-backed), outputs ESM to a Blob URL, and `import()`s it. On each build, `main.tsx` calls `root.render(App)` which **remounts** the tree — state is lost every time.

---

## Phase 1: React Refresh (State-Preserving Hot Reload)

### Approach: Regex-based `$RefreshReg$` injection (no Babel)

Full `@babel/standalone` adds ~3MB payload and 100-500ms per-file transform time — too heavy for a lightweight browser playground. Instead, we use a lightweight regex-based approach that:
- Detects PascalCase function declarations/exports and `const X = ...` arrow components
- Injects `$RefreshReg$(Component, "moduleId ComponentName")` calls at the bottom of each module
- Skips hook signature tracking (acceptable trade-off: state resets only when hooks genuinely change won't be detected, but for a demo/playground this is fine)

### Steps

**1.1 Add `react-refresh` to the import map**
```json
"react-refresh/runtime": "https://esm.sh/react-refresh@0.14.2/runtime"
```

**1.2 Initialize React Refresh runtime before React loads**

In the boot sequence, *before* the first `buildAndRun()`:
```js
const RefreshRuntime = await import("react-refresh/runtime");
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
```

This must happen before React is first imported (via the blob module). Store `RefreshRuntime` on `window.__RUNTIME__` for access inside the bundle.

**1.3 Add refresh registration injection in the VFS plugin `onLoad`**

For each `.tsx`/`.jsx` file loaded from VFS, append `$RefreshReg$` calls:
```js
// Detect PascalCase function/const declarations
// Append: $RefreshReg$(ComponentName, "/src/App.tsx ComponentName");
```

Wrap each module's code so `$RefreshReg$` / `$RefreshSig$` globals point to the runtime:
```js
var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
window.$RefreshReg$ = (type, id) => {
  window.__RUNTIME__.RefreshRuntime.register(type, "<modulePath> " + id);
};
window.$RefreshSig$ = window.__RUNTIME__.RefreshRuntime.createSignatureFunctionForTransform;
try {
  <original module code>
} finally {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
}
```

**1.4 Modify `main.tsx` — only `root.render()` on first mount**

```tsx
const root = (window.__RUNTIME__.root ??= createRoot(el));
if (!window.__RUNTIME__._mounted) {
  root.render(React.createElement(App));
  window.__RUNTIME__._mounted = true;
}
```

Subsequent updates are driven by `performReactRefresh()`, not `root.render()`.

**1.5 Call `performReactRefresh()` after import in `buildAndRun()`**

```js
await importBundle(code);
// Give React a tick, then refresh
setTimeout(() => {
  window.__RUNTIME__.RefreshRuntime.performReactRefresh();
}, 30);
```

**1.6 Update the status pill** — remove "No React Refresh yet" or change to "React Refresh active".

---

## Phase 2: Mobile Viewport Optimization

The current layout is a 2-column CSS grid (`1fr 1fr`) which doesn't work on narrow screens.

### Steps

**2.1 Stack panels vertically on mobile**

Add a media query to switch the grid to single-column on narrow viewports:
```css
@media (max-width: 768px) {
  #shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
}
```

**2.2 Make the editor textarea and preview area sized appropriately**

- Set reasonable `min-height` for both panels on mobile
- Ensure the textarea doesn't overflow horizontally (already has `resize: none` and `overflow: auto`)
- Consider adding a toggle/tab to switch between editor and preview on very small screens

**2.3 Touch-friendly button sizing**

Ensure buttons have adequate touch targets (min 44x44px per Apple HIG):
```css
@media (max-width: 768px) {
  button { min-height: 44px; padding: 8px 16px; }
}
```

**2.4 File tabs horizontal scrolling**

The file buttons row should scroll horizontally on mobile rather than wrapping:
```css
@media (max-width: 768px) {
  #files { overflow-x: auto; white-space: nowrap; flex-wrap: nowrap; }
}
```

---

## Phase 3: styled-components Integration

### Approach

Add `styled-components` as an external dependency (resolved via import map), available for use in VFS modules.

### Steps

**3.1 Add to import map**

```json
"styled-components": "https://esm.sh/*styled-components@6?external=react"
```

The `*` prefix + `?external=react` ensures esm.sh leaves React imports as bare specifiers for the browser import map to resolve (prevents duplicate React instances).

**3.2 Mark as external in the VFS plugin**

The existing `onResolve` already marks bare imports as `external: true`, so `import styled from "styled-components"` will pass through to the import map. No plugin changes needed.

**3.3 Update the demo App.tsx to use styled-components**

Replace inline styles with styled-components to demonstrate the feature:
```tsx
import styled from "styled-components";

const Container = styled.div`
  padding: 16px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
`;

// ... use in JSX
```

**3.4 Known limitations to document**

- styled-components styles defined in separate files may not update on React Refresh of importing modules (known upstream issue)
- Static styles (no prop interpolations) may not update during refresh
- For this playground context, these are acceptable trade-offs

---

## Implementation Order

1. **Phase 2 first** (Mobile viewport) — simplest, no runtime changes, quick win
2. **Phase 3 next** (styled-components) — just import map + demo update
3. **Phase 1 last** (React Refresh) — most complex, builds on the other two being stable

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| `react-refresh/runtime` from esm.sh has CJS/ESM quirks | Test import early; fall back to bundled UMD if needed |
| `injectIntoGlobalHook` timing — must run before React | Load refresh runtime in boot, before first `buildAndRun()` |
| Regex misdetects non-components as components | `$RefreshReg$` on a non-component is harmless (ignored by runtime) |
| styled-components duplicate React instance | `?external=react` on esm.sh URL prevents this |
| Mobile layout breaks existing desktop experience | Use `@media` queries, no changes to desktop layout |
