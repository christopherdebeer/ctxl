/**
 * Runtime factory.
 *
 * Creates the core runtime object that manages the VFS build pipeline,
 * LLM transport, component authoring, and React Refresh integration.
 */
import { createVFSPlugin } from "./vfs-plugin";
import { buildAuthoringPrompt } from "./prompts";
import { callLLM as llmTransport } from "./llm";
import type {
  Runtime,
  RuntimeOptions,
  FilePatch,
  ToolDef,
} from "./types";

export function createRuntime({
  esbuild,
  idb,
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

    // ---- Config persistence ----

    saveConfig() {
      localStorage.setItem("__RUNTIME_CONFIG__", JSON.stringify(this.config));
    },

    // ---- Unified LLM transport ----

    async callLLM(system: string, messages: Array<{ role: string; content: any }>, extras?: Record<string, any>) {
      return llmTransport(this.config, system, messages, extras);
    },

    // ---- Authoring prompt builder (bridged to VFS AbstractComponent) ----

    buildAuthoringPrompt(componentId: string, inputs: Record<string, any>, tools: ToolDef[], guidelines?: string, existingSource?: string): string {
      return buildAuthoringPrompt(componentId, inputs, tools, guidelines, existingSource);
    },

    // ---- Component registry regeneration ----

    regenerateRegistry() {
      const acFiles = [...files.keys()].filter(
        p => p.startsWith("/src/ac/") && p.endsWith(".tsx") && !p.endsWith("_registry.ts")
      );

      const imports: string[] = [];
      const entries: string[] = [];

      acFiles.forEach((path, i) => {
        const id = path.replace("/src/ac/", "").replace(".tsx", "");
        imports.push(`import C${i} from "./${id}";`);
        entries.push(`  "${id}": C${i}`);
      });

      const source = acFiles.length === 0
        ? `// Auto-generated component registry.\n(window as any).__COMPONENTS__ ??= {};\n`
        : `// Auto-generated component registry.\n${imports.join("\n")}\n\n(window as any).__COMPONENTS__ = {\n${entries.join(",\n")}\n};\n`;

      files.set("/src/ac/_registry.ts", source);
      idb.put("/src/ac/_registry.ts", source).catch(e => console.warn("[registry] persist failed", e));
      onFileChange("/src/ac/_registry.ts", source);
    },

    // ---- IDB access (bridged to VFS AbstractComponent for persistence) ----

    get idb() { return idb; },

    // ---- Apply file patches and rebuild ----

    async applyPatch(patches: FilePatch[]) {
      for (const p of patches) {
        files.set(p.path, p.text);
        await idb.put(p.path, p.text);
        onFileChange(p.path, p.text);
      }
      try {
        await this.buildAndRun("applyPatch");
      } catch (err: any) {
        onMode("error", "err");
        onStatus(String(err?.stack || err));
        onError(err);
        throw err;
      }
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
