/**
 * Runtime factory.
 *
 * Creates the core runtime object that manages the VFS build pipeline,
 * LLM reasoning (think/evolve), and React Refresh integration.
 * The runtime is assigned to window.__RUNTIME__ and consumed by the
 * compiled VFS components.
 */
import { createVFSPlugin } from "./vfs-plugin";
import { buildThinkPrompt, buildEvolvePrompt, buildComposePrompt } from "./prompts";
import type {
  Runtime,
  RuntimeOptions,
  LLMResult,
  ThinkResult,
  ComposeResult,
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
      const { apiMode, apiKey, proxyUrl, model } = this.config;

      if (apiMode === "none") {
        return { error: "No API configured. Set API mode in settings.", content: null };
      }

      try {
        let response: Response | undefined;
        const body = {
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          model: model || "claude-sonnet-4-5-20250929",
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

    // ---- Think: reason within current form (uses tool_use for structured output) ----
    // Builds proper multi-turn Anthropic messages from conversation history.
    // Each previous agent response is represented as a tool_use + tool_result pair.

    async think(prompt: string, agentPath: string, history?: Array<{ role: string; content: string }>): Promise<ThinkResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildThinkPrompt(agentPath, currentSource, currentState);
      const { apiMode, apiKey, proxyUrl, model } = this.config;

      if (apiMode === "none") {
        return { content: "No API configured. Set API mode in settings." };
      }

      // Tool definition for structured think output
      const thinkTool = {
        name: "think_response",
        description: "Return a structured thinking response with content, actions, and evolution decisions.",
        input_schema: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "Your text response — what you want to say or display to the user",
            },
            actions: {
              type: "array",
              items: { type: "object" },
              description: "Array of state patches to apply via act(). Each object is merged into external state.",
            },
            structured: {
              type: "object",
              description: "Any structured data to return (e.g., tasks, configurations, analysis results)",
              additionalProperties: true,
            },
            shouldEvolve: {
              type: "boolean",
              description: "Set true ONLY if you need capabilities your current source code doesn't have",
            },
            evolveReason: {
              type: "string",
              description: "If shouldEvolve is true, explain what new capabilities you need",
            },
          },
          required: ["content"],
        },
      };

      // Build proper multi-turn messages from conversation history.
      // For tool_use mode, each agent turn is a tool_use block followed by a tool_result.
      const messages: any[] = [];
      let toolCallCounter = 0;

      if (history && history.length > 0) {
        // Collect user messages and agent responses into proper API turns
        let pendingUserMessages: string[] = [];

        for (const msg of history) {
          if (msg.role === "user") {
            pendingUserMessages.push(msg.content);
          } else if (msg.role === "agent") {
            // Flush any pending user messages
            if (pendingUserMessages.length > 0) {
              // If there are previous tool results to include, merge with user content
              const userText = pendingUserMessages.join("\n\n");
              messages.push({ role: "user", content: userText });
              pendingUserMessages = [];
            }

            // Represent the agent response as a tool_use + tool_result pair
            const toolId = `toolu_hist_${toolCallCounter++}`;
            messages.push({
              role: "assistant",
              content: [{
                type: "tool_use",
                id: toolId,
                name: "think_response",
                input: { content: msg.content },
              }],
            });
            messages.push({
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: toolId,
                content: "Acknowledged.",
              }],
            });
          }
          // System messages are context — include with next user message
          else if (msg.role === "system") {
            pendingUserMessages.push(`[System: ${msg.content}]`);
          }
        }

        // Flush remaining user messages, then append the current prompt
        if (pendingUserMessages.length > 0) {
          messages.push({ role: "user", content: pendingUserMessages.join("\n\n") + "\n\n" + prompt });
        } else {
          messages.push({ role: "user", content: prompt });
        }
      } else {
        messages.push({ role: "user", content: prompt });
      }

      try {
        const body = {
          system: systemPrompt,
          messages,
          model: model || "claude-sonnet-4-5-20250929",
          max_tokens: 8192,
          tools: [thinkTool],
          tool_choice: { type: "tool", name: "think_response" },
        };

        console.log("[think] Sending request with tools:", JSON.stringify(body.tool_choice), "messages:", messages.length);

        let response: Response | undefined;

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

        if (!response) return { content: "Unsupported API mode" };
        if (!response.ok) {
          const errText = await response.text();
          return { content: `API error ${response.status}: ${errText}` };
        }

        const data = await response.json();

        console.log("[think] Response stop_reason:", data.stop_reason);
        console.log("[think] Response content types:", data.content?.map((b: any) => b.type));

        // Extract tool_use block
        const toolBlock = data.content?.find((b: any) => b.type === "tool_use" && b.name === "think_response");
        if (toolBlock?.input) {
          const input = toolBlock.input;
          return {
            content: input.content ?? undefined,
            actions: input.actions,
            structured: input.structured,
            shouldEvolve: input.shouldEvolve ?? false,
            evolveReason: input.evolveReason,
          };
        }

        // Fallback: try text block if no tool_use found
        const textBlock = data.content?.find((b: any) => b.type === "text");
        const fallbackText = textBlock?.text || data.text || "";
        try {
          const parsed = JSON.parse(fallbackText);
          return {
            content: parsed.content ?? fallbackText,
            actions: parsed.actions,
            structured: parsed.structured,
            shouldEvolve: parsed.shouldEvolve ?? false,
            evolveReason: parsed.evolveReason,
          };
        } catch {
          return { content: fallbackText };
        }
      } catch (err: any) {
        return { content: `Error: ${err.message}` };
      }
    },

    // ---- Evolve: produce new source code ----

    async evolve(prompt: string, agentPath: string): Promise<LLMResult> {
      const currentSource = this.files.get(agentPath) || "";
      const currentState = stateStore.get();
      const systemPrompt = buildEvolvePrompt(agentPath, currentSource, currentState);
      return this._callLLM(systemPrompt, prompt);
    },

    // ---- Compose: create a new child component file ----

    async compose(path: string, purpose: string, parentPath?: string): Promise<ComposeResult> {
      const parentSource = parentPath ? files.get(parentPath) : undefined;
      const existingFiles = [...files.keys()];
      const currentState = stateStore.get();
      const systemPrompt = buildComposePrompt(
        path, purpose, parentPath, parentSource, existingFiles, currentState
      );

      const { error, content } = await this._callLLM(systemPrompt, purpose);
      if (error) {
        return { error, source: null, path };
      }

      // Strip markdown code fences if present (flexible: anywhere in content)
      let source = content || "";
      const fenceMatch = source.match(/```(?:tsx?|jsx?|javascript|typescript)?\s*\n([\s\S]*?)```/);
      if (fenceMatch) {
        source = fenceMatch[1];
      }
      source = source.trim();

      if (source.startsWith("import ")) {
        files.set(path, source);
        await idb.put(path, source);
        onFileChange(path, source);
        return { error: null, source, path };
      }

      console.log("[compose] Output did not start with imports. First 200 chars:", source.slice(0, 200));
      return { error: "Composed output did not start with imports", source, path };
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
      try {
        await this.buildAndRun("applyPatch");
      } catch (err: any) {
        onMode("error", "err");
        onStatus(String(err?.stack || err));
        onError(err);
        throw err; // Re-throw so caller can handle
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
