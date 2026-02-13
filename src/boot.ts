/**
 * boot.ts — Dev environment entry point for index.html
 *
 * Imports from the ctxl module system and wires everything
 * to the dev UI: file browser, editor, settings, keyboard shortcuts, drawer.
 */

import * as esbuild from "https://unpkg.com/esbuild-wasm@0.24.2/esm/browser.min.js";
import { createIDB } from "./idb";
import { createAtomRegistry } from "./atoms";
import { createRuntime } from "./runtime";
import { SEEDS } from "./seeds-v2";
import type { Runtime, IDB } from "./types";

// ============================================================
// DOM references
// ============================================================

const statusEl = document.getElementById("status")!;
const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
const filesEl = document.getElementById("files")!;
const runBtn = document.getElementById("runBtn")!;
const resetBtn = document.getElementById("resetBtn")!;
const modePill = document.getElementById("modePill")!;
const refreshPill = document.getElementById("refreshPill")!;

const devToggle = document.getElementById("devToggle")!;
const leftDrawer = document.getElementById("left")!;
const drawerBackdrop = document.getElementById("drawerBackdrop")!;

const settingsBtn = document.getElementById("settingsBtn")!;
const settingsPanel = document.getElementById("settings") as HTMLElement;
const apiModeSelect = document.getElementById("apiModeSelect") as HTMLSelectElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const apiKeyRow = document.getElementById("apiKeyRow") as HTMLElement;
const proxyUrlInput = document.getElementById("proxyUrlInput") as HTMLInputElement;
const proxyUrlRow = document.getElementById("proxyUrlRow") as HTMLElement;
const saveSettingsBtn = document.getElementById("saveSettingsBtn")!;
const settingsStatus = document.getElementById("settingsStatus")!;

const viewTabs = document.querySelectorAll<HTMLElement>(".viewTab");
const rootEl = document.getElementById("root")!;
const inspectEl = document.getElementById("inspect")!;
const aboutEl = document.getElementById("about")!;
const aboutBody = aboutEl.querySelector(".markdown-body") as HTMLElement;

// ============================================================
// State
// ============================================================

let activePath = "/src/main.tsx";
let aboutLoaded = false;

// ============================================================
// Dev drawer
// ============================================================

function openDrawer() { leftDrawer.classList.add("open"); drawerBackdrop.classList.add("visible"); devToggle.classList.add("active"); }
function closeDrawer() { leftDrawer.classList.remove("open"); drawerBackdrop.classList.remove("visible"); devToggle.classList.remove("active"); }
function toggleDrawer() { leftDrawer.classList.contains("open") ? closeDrawer() : openDrawer(); }

devToggle.onclick = toggleDrawer;
drawerBackdrop.onclick = closeDrawer;

// ============================================================
// Status helpers
// ============================================================

function setMode(mode: string, cls = "") {
  modePill.textContent = mode;
  modePill.className = "pill " + cls;
  if (mode === "building" || mode === "importing") {
    devToggle.classList.add("building");
    devToggle.classList.remove("unsaved");
  } else {
    devToggle.classList.remove("building");
    updateUnsavedIndicator();
  }
}

function logStatus(text: string) {
  statusEl.textContent = text;
}

// ============================================================
// File browser & editor
// ============================================================

let files = new Map<string, string>();
let idb: IDB;
let runtime: Runtime;

function renderFileButtons() {
  filesEl.innerHTML = "";
  [...files.keys()].sort().forEach((path) => {
    const btn = document.createElement("button");
    btn.textContent = path;
    btn.dataset.active = String(path === activePath);
    btn.onclick = () => {
      flushEditorToVFS();
      activePath = path;
      editorEl.value = files.get(activePath) ?? "";
      renderFileButtons();
    };
    filesEl.appendChild(btn);
  });
}

function flushEditorToVFS() {
  const current = files.get(activePath) ?? "";
  if (editorEl.value !== current) {
    files.set(activePath, editorEl.value);
    idb.put(activePath, editorEl.value).catch((e: unknown) => console.warn("flush failed:", e));
  }
}

function updateUnsavedIndicator() {
  if (files.size === 0) return;
  const saved = files.get(activePath) ?? "";
  if (editorEl.value !== saved) {
    devToggle.classList.add("unsaved");
  } else {
    devToggle.classList.remove("unsaved");
  }
}

editorEl.addEventListener("input", updateUnsavedIndicator);

// ============================================================
// Settings panel
// ============================================================

function updateSettingsUI() {
  const mode = apiModeSelect.value;
  apiKeyRow.style.display = mode === "anthropic" ? "block" : "none";
  proxyUrlRow.style.display = mode === "proxy" ? "block" : "none";
}

function loadSettingsUI() {
  const cfg = runtime.config;
  apiModeSelect.value = cfg.apiMode;
  modelSelect.value = cfg.model || "claude-sonnet-4-5-20250929";
  apiKeyInput.value = cfg.apiKey;
  proxyUrlInput.value = cfg.proxyUrl;
  updateSettingsUI();
}

settingsBtn.onclick = () => {
  const isVisible = settingsPanel.style.display !== "none";
  settingsPanel.style.display = isVisible ? "none" : "block";
  if (!isVisible) loadSettingsUI();
};

apiModeSelect.onchange = updateSettingsUI;

saveSettingsBtn.onclick = () => {
  runtime.config.apiMode = apiModeSelect.value as "none" | "anthropic" | "proxy";
  runtime.config.model = modelSelect.value;
  runtime.config.apiKey = apiKeyInput.value;
  runtime.config.proxyUrl = proxyUrlInput.value;
  runtime.saveConfig();
  settingsStatus.textContent = "Saved!";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
};

// ============================================================
// View mode switching (Component | Inspect | About)
// ============================================================

async function loadAboutContent() {
  if (aboutLoaded) return;
  try {
    const res = await fetch("you-are-the-component.md");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    aboutBody.innerHTML = marked.parse(md);
    aboutLoaded = true;
  } catch (err: any) {
    aboutBody.innerHTML = `<p style="color:#c00">Failed to load documentation: ${err.message}</p>`;
  }
}

let inspectInterval: ReturnType<typeof setInterval> | null = null;

function renderInspectPanel() {
  const components = (window as any).__COMPONENTS__ || {};
  const atoms = (window as any).__ATOMS__;
  const mutations: any[] = (window as any).__MUTATIONS__ || [];

  let html = "";

  // -- Component tree --
  html += `<div class="section"><div class="section-title">Components</div>`;
  const compIds = Object.keys(components);
  if (compIds.length === 0) {
    html += `<div class="empty">No authored components yet</div>`;
  } else {
    for (const id of compIds) {
      const vfsPath = `/src/ac/${id}.tsx`;
      const source = files.get(vfsPath) || "";
      const lines = source.split("\n").length;
      html += `<div class="entry"><span class="entry-key">${id}</span><span class="entry-val">${vfsPath} (${lines} lines)</span></div>`;
    }
  }
  html += `</div>`;

  // -- Atoms --
  html += `<div class="section"><div class="section-title">Atoms</div>`;
  if (atoms && typeof atoms.keys === "function") {
    const keys: string[] = atoms.keys();
    if (keys.length === 0) {
      html += `<div class="empty">No atoms</div>`;
    } else {
      for (const k of keys) {
        try {
          const v = atoms.get(k)?.get();
          const s = JSON.stringify(v);
          const display = s && s.length > 120 ? s.slice(0, 120) + "..." : s;
          html += `<div class="entry"><span class="entry-key">${k}</span><span class="entry-val">${display}</span></div>`;
        } catch {
          html += `<div class="entry"><span class="entry-key">${k}</span><span class="entry-val">&lt;unreadable&gt;</span></div>`;
        }
      }
    }
  } else {
    html += `<div class="empty">No atom registry</div>`;
  }
  html += `</div>`;

  // -- Mutation log --
  html += `<div class="section"><div class="section-title">Mutation Log</div>`;
  if (mutations.length === 0) {
    html += `<div class="empty">No mutations recorded</div>`;
  } else {
    for (let i = mutations.length - 1; i >= 0; i--) {
      const m = mutations[i];
      const cls = m.outcome === "rollback" ? "mutation rollback" : "mutation";
      const time = new Date(m.timestamp).toLocaleTimeString();
      html += `<div class="${cls}"><div class="trigger">[${m.componentId}] ${m.trigger}</div><div class="meta">${m.outcome} at ${time}</div></div>`;
    }
  }
  html += `</div>`;

  inspectEl.innerHTML = html;
}

function setView(view: string) {
  viewTabs.forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));

  rootEl.classList.toggle("hidden", view !== "component");
  inspectEl.classList.toggle("active", view === "inspect");
  aboutEl.classList.toggle("active", view === "about");

  if (view === "about") loadAboutContent();

  // Auto-refresh inspect panel while visible
  if (inspectInterval) { clearInterval(inspectInterval); inspectInterval = null; }
  if (view === "inspect") {
    renderInspectPanel();
    inspectInterval = setInterval(renderInspectPanel, 2000);
  }
}

viewTabs.forEach(tab => { tab.onclick = () => setView(tab.dataset.view!); });

// ============================================================
// Keyboard shortcuts
// ============================================================

window.addEventListener("keydown", (e) => {
  const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
  const isToggle = (e.ctrlKey || e.metaKey) && (e.key === "\\" || e.key.toLowerCase() === "e");
  if (isSave) { e.preventDefault(); flushEditorToVFS(); runtime.buildAndRun("Ctrl/Cmd+S").catch(() => {}); }
  if (isToggle) { e.preventDefault(); toggleDrawer(); }
  if (e.key === "Escape" && leftDrawer.classList.contains("open")) closeDrawer();
});

// ============================================================
// Boot sequence
// ============================================================

const savedConfig = JSON.parse(localStorage.getItem("__RUNTIME_CONFIG__") || "{}");
const defaultProxyUrl = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3001/api/chat"
  : "/api/chat";

// 1. IndexedDB
idb = createIDB();

// 2. Atom registry (persistent shared state)
const atomRegistry = createAtomRegistry();
await atomRegistry.hydrate(idb);
(window as any).__ATOMS__ = atomRegistry;

// 3. Load or seed VFS
files = new Map<string, string>();
const rows = await idb.getAll();
const vfsRows = rows.filter(r => !r.path.startsWith("__atom:"));

if (vfsRows.length === 0) {
  for (const [p, t] of SEEDS.entries()) {
    files.set(p, t);
    await idb.put(p, t);
  }
} else {
  for (const r of vfsRows) files.set(r.path, r.text);
}

renderFileButtons();
editorEl.value = files.get(activePath) ?? "";
logStatus("Loaded VFS. Initial build pending...");

// 4. Create runtime
const config = {
  apiMode: savedConfig.apiMode || "none",
  apiKey: savedConfig.apiKey || "",
  proxyUrl: savedConfig.proxyUrl || defaultProxyUrl,
  model: savedConfig.model || "claude-sonnet-4-5-20250929",
};

runtime = createRuntime({
  esbuild,
  idb,
  files,
  config,
  callbacks: {
    onStatus: logStatus,
    onMode: setMode,
    onFileChange(path: string, text: string) {
      if (path === activePath) editorEl.value = text;
      renderFileButtons();
    },
    onError(err: unknown) {
      console.error("[ctxl] Build error:", err);
    },
  },
});
window.__RUNTIME__ = runtime;

// 5. React Refresh
const refreshOk = await runtime.initRefresh();
if (refreshOk) {
  refreshPill.textContent = "React Refresh active";
  refreshPill.classList.remove("warn");
} else {
  refreshPill.textContent = "React Refresh failed";
  refreshPill.classList.add("err");
}

// 6. esbuild
await runtime.initEsbuild();

// 7. Wire up buttons
runBtn.onclick = () => { flushEditorToVFS(); runtime.buildAndRun("button").catch(() => {}); };
resetBtn.onclick = () => runtime.reset();

// 8. First build
await runtime.buildAndRun("startup");
