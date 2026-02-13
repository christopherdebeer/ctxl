// ---- VFS / IDB ----

export interface VFSRow {
  path: string;
  text: string;
}

export interface IDB {
  getAll(): Promise<VFSRow[]>;
  put(path: string, text: string): Promise<void>;
  clear(): Promise<void>;
}

// ---- Config ----

export type ApiMode = "none" | "anthropic" | "proxy";

export interface RuntimeConfig {
  apiMode: ApiMode;
  apiKey: string;
  proxyUrl: string;
  model: string;
}

// ---- Callbacks ----

export interface RuntimeCallbacks {
  onStatus?: (text: string) => void;
  onMode?: (mode: string, cls: string) => void;
  onFileChange?: (path: string, text: string) => void;
  onBuildStart?: () => void;
  onBuildEnd?: (buildNumber: number, ms: number) => void;
  onError?: (err: unknown) => void;
}

// ---- Patches ----

export interface FilePatch {
  path: string;
  text: string;
  reason?: string;
}

// ---- esbuild (minimal types for CDN-loaded esbuild-wasm) ----

export interface EsbuildPlugin {
  name: string;
  setup(build: any): void;
}

export interface Esbuild {
  initialize(options: { wasmURL: string; worker: boolean }): Promise<void>;
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    format: string;
    platform: string;
    sourcemap: string;
    write: boolean;
    jsx: string;
    plugins: EsbuildPlugin[];
  }): Promise<{ outputFiles?: Array<{ text: string }> }>;
}

// ---- Runtime ----

export interface Runtime {
  files: Map<string, string>;
  disposers: Array<() => void>;
  config: RuntimeConfig;
  RefreshRuntime: any;
  idb: IDB;

  // Config
  saveConfig(): void;

  // v2: Unified LLM transport
  callLLM(system: string, messages: Array<{ role: string; content: any }>, extras?: Record<string, any>): Promise<any>;

  // v2: Authoring
  buildAuthoringPrompt(componentId: string, inputs: Record<string, any>, tools: ToolDef[], handlers?: Record<string, string>, guidelines?: string, existingSource?: string): string;
  regenerateRegistry(): void;

  // Build pipeline
  applyPatch(patches: FilePatch[]): Promise<void>;
  runDisposers(): void;
  buildBundle(entry?: string): Promise<{ code: string; ms: number }>;
  importBundle(code: string): Promise<unknown>;
  buildAndRun(reason?: string): Promise<void>;

  // Init
  initRefresh(): Promise<boolean>;
  initEsbuild(wasmURL?: string): Promise<void>;
  reset(): Promise<void>;
}

// ---- Factory options ----

export interface RuntimeOptions {
  esbuild: Esbuild;
  idb: IDB;
  files: Map<string, string>;
  config: RuntimeConfig;
  callbacks?: RuntimeCallbacks;
}

// ---- Create API ----

export interface CreateOptions {
  target?: HTMLElement;
  seeds?: Map<string, string>;
  apiMode?: ApiMode;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  esbuildUrl?: string;
  esbuildWasmUrl?: string;
  dbName?: string;
  callbacks?: RuntimeCallbacks;
}

export interface CreateResult {
  runtime: Runtime;
  files: Map<string, string>;
  idb: IDB;
}

// ---- Tools ----

export interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, string>;
  handler?: (args: any) => any;
}

// ---- Handlers (implementation callbacks for authored components) ----

export interface HandlerDef {
  description: string;
  fn: (...args: any[]) => any;
}

// ---- Reasoning ----

export interface ReasoningResult {
  content?: string;
  structured?: any;
  toolCalls?: Array<{ name: string; args: any }>;
  reshape?: { reason: string };
}

// ---- Mutations ----

export interface MutationRecord {
  id: string;
  timestamp: number;
  componentId: string;
  trigger: string;
  previousSource: string;
  newSource: string;
  outcome: "swap" | "remount" | "crash-recovery" | "rollback";
}
