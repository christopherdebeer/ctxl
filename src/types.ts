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

// ---- State ----

export type AgentMemory = Record<string, any>;

export interface StateMeta {
  cycle: number;
  mutations: Array<{ timestamp: number; reason: string; path: string }>;
  thinkHistory: Array<{ timestamp: number; prompt: string; result: ThinkResult }>;
}

export interface StateStore {
  memory: AgentMemory;
  meta: StateMeta;
  _listeners: Set<(memory: AgentMemory) => void>;
  get(): AgentMemory;
  set(patch: Partial<AgentMemory>): void;
  subscribe(fn: (memory: AgentMemory) => void): () => boolean;
  _notify(): void;
}

// ---- Config ----

export type ApiMode = "none" | "anthropic" | "proxy";

export interface RuntimeConfig {
  apiMode: ApiMode;
  apiKey: string;
  proxyUrl: string;
  model: string;
}

// ---- LLM ----

export interface LLMResult {
  error: string | null;
  content: string | null;
}

export interface ThinkResult {
  content?: string;
  actions?: Record<string, any>[];
  structured?: unknown;
  shouldEvolve?: boolean;
  evolveReason?: string;
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

export interface ComposeResult {
  error: string | null;
  source: string | null;
  path: string;
}

export interface ConversationMessage {
  role: "user" | "agent";
  content: string;
}

export interface Runtime {
  files: Map<string, string>;
  disposers: Array<() => void>;
  config: RuntimeConfig;
  RefreshRuntime: any;
  AgentModule: { default: any } | null;
  root: any;
  _mounted: boolean;
  saveConfig(): void;
  _callLLM(systemPrompt: string, userPrompt: string): Promise<LLMResult>;
  think(prompt: string, agentPath: string, history?: ConversationMessage[]): Promise<ThinkResult>;
  evolve(prompt: string, agentPath: string): Promise<LLMResult>;
  compose(path: string, purpose: string, parentPath?: string): Promise<ComposeResult>;
  reason(prompt: string, agentPath: string): Promise<LLMResult>;
  applyPatch(patches: FilePatch[]): Promise<void>;
  runDisposers(): void;
  buildBundle(entry?: string): Promise<{ code: string; ms: number }>;
  importBundle(code: string): Promise<unknown>;
  buildAndRun(reason?: string): Promise<void>;
  initRefresh(): Promise<boolean>;
  initEsbuild(wasmURL?: string): Promise<void>;
  reset(): Promise<void>;
}

// ---- Factory options ----

export interface RuntimeOptions {
  esbuild: Esbuild;
  idb: IDB;
  stateStore: StateStore;
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
  stateStore: StateStore;
  idb: IDB;
}

// ====================================================================
// v2: Abstract Component types
// ====================================================================

// ---- Tools ----

export interface ToolDef {
  name: string;
  description: string;
  schema?: Record<string, string>;
}

// ---- Reasoning ----

export interface ReasoningResult {
  content?: string;
  structured?: any;
  toolCalls?: Array<{ name: string; args: any }>;
  reshape?: { reason: string };
}

// ---- Mutations (v2) ----

export interface MutationRecord {
  id: string;
  timestamp: number;
  componentId: string;
  trigger: string;
  previousSource: string;
  newSource: string;
  outcome: "swap" | "remount" | "crash-recovery" | "rollback";
}
