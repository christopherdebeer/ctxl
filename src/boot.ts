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
const aboutEl = document.getElementById("about")!;
const aboutBody = aboutEl.querySelector(".markdown-body") as HTMLElement;

const closeDrawerBtn = document.getElementById("closeDrawerBtn")!;
const drawerTabs = document.querySelectorAll<HTMLElement>(".drawerTab");
const drawerInspectEl = document.getElementById("drawerInspect")!;
const drawerLogEl = document.getElementById("drawerLog")!;
const drawerContentEl = document.getElementById("drawerContent")!;

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
closeDrawerBtn.onclick = closeDrawer;

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

  drawerInspectEl.innerHTML = html;
}

// ---- Log panel rendering ----

let lastRenderedLogLen = 0;

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function summarizeResponse(entry: any): { pills: string; preview: string } {
  if (entry.error) {
    return { pills: `<span class="log-pill error">error</span>`, preview: escHtml(entry.error).slice(0, 120) };
  }
  const data = entry.response;
  if (!data?.content) return { pills: "", preview: "no content" };

  const pills: string[] = [];
  let preview = "";
  for (const block of data.content) {
    if (block.type === "text") {
      pills.push(`<span class="log-pill text">text</span>`);
      if (!preview) preview = escHtml(block.text || "").slice(0, 80);
    } else if (block.type === "tool_use") {
      pills.push(`<span class="log-pill tool-use">${escHtml(block.name)}</span>`);
      if (!preview && block.input) {
        const keys = Object.keys(block.input);
        preview = keys.slice(0, 3).join(", ") + (keys.length > 3 ? "..." : "");
      }
    }
  }
  return { pills: pills.join(" "), preview };
}

function buildLogEntryHtml(e: any): string {
  const time = new Date(e.timestamp).toLocaleTimeString();
  const srcType = e.source.split(":")[0];
  const { pills } = summarizeResponse(e);
  const dur = e.durationMs != null ? `${e.durationMs}ms` : "";

  // Build expandable body content
  let body = "";

  // For dispatch entries, show compact info
  if (srcType === "dispatch") {
    const r = e.response || {};
    body += `Tool: ${escHtml(r.tool || "?")}\nArgs: ${escHtml(JSON.stringify(r.args, null, 2) || "{}")}\nRoute: ${escHtml(r.route || "?")}\nResult: ${escHtml(JSON.stringify(r.result) || "undefined")}`;
  } else {
    // Show user messages (truncated)
    if (e.messages?.length) {
      body += "--- Messages ---\n";
      for (const m of e.messages) {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        body += `[${escHtml(m.role)}] ${escHtml(content.slice(0, 500))}${content.length > 500 ? "..." : ""}\n\n`;
      }
    }
    // Show response content blocks
    if (e.response?.content) {
      body += "--- Response ---\n";
      for (const block of e.response.content) {
        if (block.type === "text") {
          body += `[text] ${escHtml(block.text || "")}\n\n`;
        } else if (block.type === "tool_use") {
          body += `[tool_use] ${escHtml(block.name)} (id: ${escHtml(block.id || "")})\n${escHtml(JSON.stringify(block.input, null, 2) || "{}")}\n\n`;
        }
      }
    }
    if (e.error) {
      body += `--- Error ---\n${escHtml(e.error)}\n`;
    }
  }

  let html = `<div class="log-entry" data-log-id="${escHtml(e.id)}">`;
  html += `<div class="log-header" onclick="this.nextElementSibling.classList.toggle('open')">`;
  html += `<span class="log-source ${escHtml(srcType)}">${escHtml(e.source)}</span>`;
  html += pills;
  if (e.error) html += `<span class="log-error">ERR</span>`;
  if (dur) html += `<span class="log-duration">${dur}</span>`;
  html += `<span class="log-time">${time}</span>`;
  html += `</div>`;
  html += `<div class="log-body">${body}</div>`;
  html += `</div>`;
  return html;
}

function renderLogPanel() {
  const log: any[] = (window as any).__LOG__ || [];

  if (log.length === 0) {
    if (lastRenderedLogLen !== 0) {
      lastRenderedLogLen = 0;
      drawerLogEl.innerHTML = `<div class="log-empty">No LLM calls yet. Configure API and interact with a component.</div>`;
    }
    return;
  }

  // No new entries — skip re-render to preserve expanded/interaction state
  if (log.length === lastRenderedLogLen) return;

  // Collect currently expanded entry IDs before DOM update
  const expandedIds = new Set<string>();
  drawerLogEl.querySelectorAll(".log-body.open").forEach((el) => {
    const entry = el.closest(".log-entry") as HTMLElement | null;
    if (entry?.dataset.logId) expandedIds.add(entry.dataset.logId);
  });

  // If the log shrank (capped at 100 via splice) or is the first render,
  // do a full rebuild; otherwise only prepend new entries.
  if (lastRenderedLogLen === 0 || log.length < lastRenderedLogLen) {
    let html = "";
    for (let i = log.length - 1; i >= 0; i--) {
      html += buildLogEntryHtml(log[i]);
    }
    drawerLogEl.innerHTML = html;
  } else {
    // Prepend only new entries at the top (newest first display order)
    let newHtml = "";
    for (let i = log.length - 1; i >= lastRenderedLogLen; i--) {
      newHtml += buildLogEntryHtml(log[i]);
    }
    drawerLogEl.insertAdjacentHTML("afterbegin", newHtml);
  }

  lastRenderedLogLen = log.length;

  // Restore expanded state for previously open entries
  expandedIds.forEach(id => {
    const entry = drawerLogEl.querySelector(`.log-entry[data-log-id="${id}"]`);
    const body = entry?.querySelector(".log-body");
    if (body) body.classList.add("open");
  });
}

// ---- Drawer internal tabs (Code | Inspect | Log) ----

let activeDrawerTab = "code";
let logInterval: ReturnType<typeof setInterval> | null = null;

function setDrawerTab(tab: string) {
  activeDrawerTab = tab;
  drawerTabs.forEach(t => t.classList.toggle("active", t.dataset.drawer === tab));

  // Toggle content visibility
  editorEl.style.display = tab === "code" ? "" : "none";
  drawerInspectEl.classList.toggle("active", tab === "inspect");
  drawerLogEl.classList.toggle("active", tab === "log");

  // Show/hide files bar (only relevant for code tab)
  filesEl.style.display = tab === "code" ? "" : "none";

  // Auto-refresh inspect while visible
  if (inspectInterval) { clearInterval(inspectInterval); inspectInterval = null; }
  if (tab === "inspect") {
    renderInspectPanel();
    inspectInterval = setInterval(renderInspectPanel, 2000);
  }

  // Auto-refresh log while visible
  if (logInterval) { clearInterval(logInterval); logInterval = null; }
  if (tab === "log") {
    renderLogPanel();
    logInterval = setInterval(renderLogPanel, 2000);
  }
}

drawerTabs.forEach(tab => { tab.onclick = () => setDrawerTab(tab.dataset.drawer!); });

// ---- Preview view switching (Component | About) ----

function setView(view: string) {
  viewTabs.forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));

  rootEl.classList.toggle("hidden", view !== "component");
  aboutEl.classList.toggle("active", view === "about");

  if (view === "about") loadAboutContent();
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
