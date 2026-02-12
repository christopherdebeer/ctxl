/**
 * Runtime factory.
 *
 * Creates the core runtime object that manages the VFS build pipeline,
 * LLM reasoning, and React Refresh integration.
 *
 * v1 methods (think/evolve/compose/_callLLM) are kept for backward compatibility.
 * v2 additions: callLLM (unified transport), regenerateRegistry, buildAuthoringPrompt.
 */
import { createVFSPlugin } from "./vfs-plugin";
import { buildThinkPrompt, buildEvolvePrompt, buildComposePrompt, buildAuthoringPrompt } from "./prompts";
import { callLLM as llmTransport } from "./llm";
import type {
  Runtime,
  RuntimeOptions,
  LLMResult,
  ThinkResult,
  ComposeResult,
  FilePatch,
  ToolDef,
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

    // ==================================================================
    // v2: Unified LLM transport (used by VFS hooks and AbstractComponent)
    // ==================================================================

    async callLLM(system: string, messages: Array<{ role: string; content: any }>, extras?: Record<string, any>) {
      return llmTransport(this.config, system, messages, extras);
    },

    // ==================================================================
    // v2: Authoring prompt builder (bridged to VFS AbstractComponent)
    // ==================================================================

    buildAuthoringPrompt(componentId: string, inputs: Record<string, any>, tools: ToolDef[], guidelines?: string, existingSource?: string): string {
      return buildAuthoringPrompt(componentId, inputs, tools, guidelines, existingSource);
    },

    // ==================================================================
    // v2: Registry regeneration
    // ==================================================================

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

    // ==================================================================
    // v2: IDB access (bridged to VFS AbstractComponent for persistence)
    // ==================================================================

    get idb() { return idb; },

    // ==================================================================
    // v1: LLM call (shared by think and evolve)
    // ==================================================================

    async _callLLM(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
      const result = await llmTransport(
        this.config,
        systemPrompt,
        [{ role: "user", content: userPrompt }],
      );
      if (result.error) return { error: result.error, content: null };
      const text = result.data?.content?.[0]?.text || result.data?.text || "";
      return { error: null, content: text };
    },

    // ==================================================================
    // v1: Think (reason within current form)
    // ==================================================================

    async think(prompt: string, agentPath: string, history?: Array<{ role: string; content: string }>): Promise<ThinkResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildThinkPrompt(agentPath, currentSource, currentState);

      if (this.config.apiMode === "none") {
        return { content: "No API configured. Set API mode in settings." };
      }

      const thinkTool = {
        name: "think_response",
        description: "Return a structured thinking response.",
        input_schema: {
          type: "object" as const,
          properties: {
            content: { type: "string", description: "Your text response" },
            actions: { type: "array", items: { type: "object" }, description: "State patches" },
            structured: { type: "object", description: "Structured data", additionalProperties: true },
            shouldEvolve: { type: "boolean", description: "Need capabilities upgrade?" },
            evolveReason: { type: "string", description: "Why evolve?" },
          },
          required: ["content"],
        },
      };

      // Build messages from history
      const messages: any[] = [];
      let toolCallCounter = 0;

      if (history && history.length > 0) {
        let pendingUser: string[] = [];
        for (const msg of history) {
          if (msg.role === "user") {
            pendingUser.push(msg.content);
          } else if (msg.role === "agent") {
            if (pendingUser.length > 0) {
              messages.push({ role: "user", content: pendingUser.join("\n\n") });
              pendingUser = [];
            }
            const toolId = `toolu_hist_${toolCallCounter++}`;
            messages.push({ role: "assistant", content: [{ type: "tool_use", id: toolId, name: "think_response", input: { content: msg.content } }] });
            messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "Acknowledged." }] });
          } else if (msg.role === "system") {
            pendingUser.push(`[System: ${msg.content}]`);
          }
        }
        if (pendingUser.length > 0) {
          messages.push({ role: "user", content: pendingUser.join("\n\n") + "\n\n" + prompt });
        } else {
          messages.push({ role: "user", content: prompt });
        }
      } else {
        messages.push({ role: "user", content: prompt });
      }

      const result = await llmTransport(this.config, systemPrompt, messages, {
        tools: [thinkTool],
        tool_choice: { type: "tool", name: "think_response" },
      });

      if (result.error) return { content: `Error: ${result.error}` };

      const toolBlock = result.data?.content?.find((b: any) => b.type === "tool_use" && b.name === "think_response");
      if (toolBlock?.input) {
        return {
          content: toolBlock.input.content ?? undefined,
          actions: toolBlock.input.actions,
          structured: toolBlock.input.structured,
          shouldEvolve: toolBlock.input.shouldEvolve ?? false,
          evolveReason: toolBlock.input.evolveReason,
        };
      }

      const textBlock = result.data?.content?.find((b: any) => b.type === "text");
      const fallbackText = textBlock?.text || "";
      try {
        const parsed = JSON.parse(fallbackText);
        return { content: parsed.content ?? fallbackText, actions: parsed.actions, structured: parsed.structured, shouldEvolve: parsed.shouldEvolve ?? false, evolveReason: parsed.evolveReason };
      } catch {
        return { content: fallbackText };
      }
    },

    // v1: Evolve
    async evolve(prompt: string, agentPath: string): Promise<LLMResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildEvolvePrompt(agentPath, currentSource, currentState);
      return this._callLLM(systemPrompt, prompt);
    },

    // v1: Compose
    async compose(path: string, purpose: string, parentPath?: string): Promise<ComposeResult> {
      const parentSource = parentPath ? files.get(parentPath) : undefined;
      const existingFiles = [...files.keys()];
      const currentState = stateStore.get();
      const systemPrompt = buildComposePrompt(path, purpose, parentPath, parentSource, existingFiles, currentState);
      const { error, content } = await this._callLLM(systemPrompt, purpose);
      if (error) return { error, source: null, path };
      let source = content || "";
      const fenceMatch = source.match(/```(?:tsx?|jsx?|javascript|typescript)?\s*\n([\s\S]*?)```/);
      if (fenceMatch) source = fenceMatch[1];
      source = source.trim();
      if (source.startsWith("import ")) {
        files.set(path, source);
        await idb.put(path, source);
        onFileChange(path, source);
        return { error: null, source, path };
      }
      return { error: "Composed output did not start with imports", source, path };
    },

    // v1: Legacy alias
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
  } as any; // v2 methods extend beyond the v1 Runtime interface

  return runtime;
}
