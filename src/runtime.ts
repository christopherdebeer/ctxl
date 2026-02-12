/**
 * Runtime factory.
 *
 * Creates the core runtime object that manages the VFS build pipeline,
 * LLM reasoning (think/evolve), and React Refresh integration.
 * The runtime is assigned to window.__RUNTIME__ and consumed by the
 * compiled VFS components.
 */
import { createVFSPlugin } from "./vfs-plugin";
import { buildThinkPrompt, buildEvolvePrompt } from "./prompts";
import type {
  Runtime,
  RuntimeOptions,
  LLMResult,
  ThinkResult,
  FilePatch,
} from "./types";

export function createRuntime({
  esbuild,
  idb,
  stateStore,
  files,
  config,
  callbacks = {},
}: RuntimeOptions): Runtime {
  let currentBlobUrl: string | null = null;
  let buildCounter = 0;

  const {
    onStatus = () => {},
    onMode = () => {},
    onFileChange = () => {},
    onBuildStart = () => {},
    onBuildEnd = () => {},
    onError = () => {},
  } = callbacks;

  const runtime: Runtime = {
    files,
    disposers: [],
    config,
    RefreshRuntime: null,
    AgentModule: null,
    root: null,
    _mounted: false,

    // ---- Config persistence ----

    saveConfig() {
      localStorage.setItem("__RUNTIME_CONFIG__", JSON.stringify(this.config));
    },

    // ---- LLM call (shared by think and evolve) ----

    async _callLLM(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
      const { apiMode, apiKey, proxyUrl } = this.config;

      if (apiMode === "none") {
        return { error: "No API configured. Set API mode in settings.", content: null };
      }

      try {
        let response: Response | undefined;
        const body = {
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
        };

        if (apiMode === "anthropic") {
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify(body),
          });
        } else if (apiMode === "proxy") {
          response = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }

        if (!response) {
          return { error: "Unsupported API mode", content: null };
        }

        if (!response.ok) {
          const errText = await response.text();
          return { error: `API error ${response.status}: ${errText}`, content: null };
        }

        const data = await response.json();
        const content: string = data.content?.[0]?.text || data.text || "";
        return { error: null, content };
      } catch (err: any) {
        return { error: err.message, content: null };
      }
    },

    // ---- Think: reason within current form ----

    async think(prompt: string, agentPath: string): Promise<ThinkResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildThinkPrompt(agentPath, currentSource, currentState);

      const { error, content } = await this._callLLM(systemPrompt, prompt);
      if (error) {
        return { content: `Error: ${error}` };
      }

      // Try to parse as structured JSON, fallback to plain text
      try {
        const parsed = JSON.parse(content!);
        return {
          content: parsed.content ?? content,
          actions: parsed.actions,
          structured: parsed.structured,
          shouldEvolve: parsed.shouldEvolve ?? false,
          evolveReason: parsed.evolveReason,
        };
      } catch {
        return { content: content ?? undefined };
      }
    },

    // ---- Evolve: produce new source code ----

    async evolve(prompt: string, agentPath: string): Promise<LLMResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildEvolvePrompt(agentPath, currentSource, currentState);
      return this._callLLM(systemPrompt, prompt);
    },

    // ---- Legacy alias ----
    async reason(prompt: string, agentPath: string): Promise<LLMResult> {
      return this.evolve(prompt, agentPath);
    },

    // ---- Apply file patches and rebuild ----

    async applyPatch(patches: FilePatch[]) {
      for (const p of patches) {
        files.set(p.path, p.text);
        await idb.put(p.path, p.text);
        onFileChange(p.path, p.text);
      }
      await this.buildAndRun("applyPatch");
    },

    // ---- Dispose protocol ----

    runDisposers() {
      while (this.disposers.length) {
        const fn = this.disposers.pop()!;
        try { fn(); } catch (e) { console.warn("[dispose]", e); }
      }
    },

    // ---- Build pipeline ----

    async buildBundle(entry = "/src/main.tsx") {
      const t0 = performance.now();
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        platform: "browser",
        sourcemap: "inline",
        write: false,
        jsx: "automatic",
        plugins: [createVFSPlugin(files, { RefreshRuntime: this.RefreshRuntime })],
      });
      const out = result.outputFiles?.[0];
      if (!out?.text) throw new Error("esbuild produced no output");
      return { code: out.text, ms: Math.round(performance.now() - t0) };
    },

    async importBundle(code: string) {
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      const blob = new Blob([code], { type: "text/javascript" });
      currentBlobUrl = URL.createObjectURL(blob);
      return import(/* @vite-ignore */ currentBlobUrl);
    },

    async buildAndRun(reason = "manual") {
      onMode("building", "warn");
      onStatus(`Building (${reason})...`);
      onBuildStart();
      try {
        const { code, ms } = await this.buildBundle();
        buildCounter++;
        this.runDisposers();
        onMode("importing", "warn");
        onStatus(`Build #${buildCounter} OK in ${ms}ms. Importing...`);
        await this.importBundle(code);

        if (this.RefreshRuntime) {
          setTimeout(() => this.RefreshRuntime.performReactRefresh(), 30);
        }

        onMode("running", "");
        onStatus(`Build #${buildCounter} running. (${ms}ms)`);
        onBuildEnd(buildCounter, ms);
      } catch (err: any) {
        onMode("error", "err");
        onStatus(String(err?.stack || err));
        onError(err);
      }
    },

    // ---- Init React Refresh ----

    async initRefresh() {
      try {
        const RefreshRuntime = await import(/* @vite-ignore */ "react-refresh/runtime");
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type: any) => type;
        this.RefreshRuntime = RefreshRuntime;
        return true;
      } catch (err) {
        console.error("[ctxl] React Refresh failed:", err);
        return false;
      }
    },

    // ---- Init esbuild ----

    async initEsbuild(wasmURL = "https://unpkg.com/esbuild-wasm@0.24.2/esbuild.wasm") {
      onMode("init", "warn");
      await esbuild.initialize({ wasmURL, worker: true });
      onMode("ready", "");
    },

    // ---- Reset to seed state ----

    async reset() {
      await idb.clear();
      location.reload();
    },
  };

  return runtime;
}
