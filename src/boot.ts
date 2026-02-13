/**
 * boot.ts — Dev environment entry point for index.html
 *
 * Uses the same initSystem() code path as <CtxlProvider> so the dev
 * environment dogfoods the identical boot sequence that library consumers get.
 * The VFS main.tsx wraps its React tree in <RuntimeContext.Provider>,
 * completing the dogfooding loop.
 */

import { initSystem } from "./init";
import { createEditor, type EditorInstance } from "./editor";
import type { Runtime, IDB } from "./types";

// ============================================================
// DOM references
// ============================================================

const statusEl = document.getElementById("status")!;
const editorEl = document.getElementById("editor")!;
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
let editor: EditorInstance;

function renderFileButtons() {
  filesEl.innerHTML = "";
  [...files.keys()].sort().forEach((path) => {
    const btn = document.createElement("button");
    btn.textContent = path;
    btn.dataset.active = String(path === activePath);
    btn.onclick = () => {
      flushEditorToVFS();
      activePath = path;
      editor.setValue(files.get(activePath) ?? "");
      renderFileButtons();
    };
    filesEl.appendChild(btn);
  });
}

function flushEditorToVFS() {
  const current = files.get(activePath) ?? "";
  const editorContent = editor.getValue();
  if (editorContent !== current) {
    files.set(activePath, editorContent);
    idb.put(activePath, editorContent).catch((e: unknown) => console.warn("flush failed:", e));
  }
}

function updateUnsavedIndicator() {
  if (files.size === 0) return;
  const saved = files.get(activePath) ?? "";
  if (editor.getValue() !== saved) {
    devToggle.classList.add("unsaved");
  } else {
    devToggle.classList.remove("unsaved");
  }
}

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
  // CM6 handles Mod-s internally via its keymap; only handle save when
  // the event originates outside the editor to avoid double-triggering.
  const fromEditor = editorEl.contains(e.target as Node);
  if (isSave && !fromEditor) { e.preventDefault(); flushEditorToVFS(); runtime.buildAndRun("Ctrl/Cmd+S").catch(() => {}); }
  if (isSave && fromEditor) { e.preventDefault(); }
  if (isToggle) { e.preventDefault(); toggleDrawer(); }
  if (e.key === "Escape" && leftDrawer.classList.contains("open")) closeDrawer();
});

// ============================================================
// Boot sequence — uses the same initSystem() as <CtxlProvider>
// ============================================================

const savedConfig = JSON.parse(localStorage.getItem("__RUNTIME_CONFIG__") || "{}");
const defaultProxyUrl = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3001/api/chat"
  : "/api/chat";

logStatus("Booting ctxl (shared initSystem path)...");

// Mount CodeMirror 6 editor (can happen before system init)
editor = createEditor(editorEl, {
  onChange: updateUnsavedIndicator,
  onSave() { flushEditorToVFS(); runtime.buildAndRun("Ctrl/Cmd+S").catch(() => {}); },
});

const system = await initSystem({
  apiMode: savedConfig.apiMode || "none",
  apiKey: savedConfig.apiKey || "",
  proxyUrl: savedConfig.proxyUrl || defaultProxyUrl,
  model: savedConfig.model || "claude-sonnet-4-5-20250929",
  callbacks: {
    onStatus: logStatus,
    onMode: setMode,
    onFileChange(path: string, text: string) {
      if (path === activePath) editor.setValue(text);
      renderFileButtons();
    },
    onError(err: unknown) {
      console.error("[ctxl] Build error:", err);
    },
  },
});

runtime = system.runtime;
files = system.files;
idb = system.idb;

// React Refresh status
if (runtime.RefreshRuntime) {
  refreshPill.textContent = "React Refresh active";
  refreshPill.classList.remove("warn");
} else {
  refreshPill.textContent = "React Refresh failed";
  refreshPill.classList.add("err");
}

// Render file browser with loaded VFS
renderFileButtons();
editor.setValue(files.get(activePath) ?? "");

// Wire up buttons
runBtn.onclick = () => { flushEditorToVFS(); runtime.buildAndRun("button").catch(() => {}); };
resetBtn.onclick = () => runtime.reset();

// First build
await runtime.buildAndRun("startup");
