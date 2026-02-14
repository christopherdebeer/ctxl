/**
 * LLM transport — single fetch function supporting Anthropic direct and proxy modes.
 *
 * Accepts arbitrary extra body fields (tools, tool_choice, etc.)
 * so callers don't need to duplicate the fetch plumbing.
 *
 * Every call is logged to window.__LOG__ for the dev drawer's Log tab.
 */
import type { RuntimeConfig } from "./types";

export interface LLMResponse {
  error: string | null;
  data: any;
}

// ---- Transcript log ----

export interface LogEntry {
  id: string;
  timestamp: number;
  /** Who initiated: "author:{id}" | "reasoning:{id}" | "unknown" */
  source: string;
  system: string;
  messages: Array<{ role: string; content: any }>;
  tools?: any[];
  toolChoice?: any;
  model: string;
  response?: any;
  error?: string;
  durationMs?: number;
}

function pushLog(entry: LogEntry) {
  const w = window as any;
  if (!w.__LOG__) w.__LOG__ = [];
  w.__LOG__.push(entry);
  // Cap at 100 entries
  if (w.__LOG__.length > 100) w.__LOG__.splice(0, w.__LOG__.length - 100);
}

export async function callLLM(
  config: RuntimeConfig,
  system: string,
  messages: Array<{ role: string; content: any }>,
  extras?: Record<string, any>,
): Promise<LLMResponse> {
  const { apiMode, apiKey, proxyUrl, model } = config;

  const logEntry: LogEntry = {
    id: Math.random().toString(36).slice(2, 10),
    timestamp: Date.now(),
    source: (extras as any)?._source || "unknown",
    system,
    messages,
    tools: extras?.tools,
    toolChoice: extras?.tool_choice,
    model: model || "claude-sonnet-4-5-20250929",
  };

  if (apiMode === "none") {
    logEntry.error = "No API configured";
    pushLog(logEntry);
    return { error: "No API configured. Set API mode in settings.", data: null };
  }

  // Strip internal _source from extras before sending
  const { _source, ...cleanExtras } = (extras || {}) as any;

  const body: Record<string, any> = {
    system,
    messages,
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    ...cleanExtras,
  };

  const t0 = performance.now();

  try {
    let response: Response;

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
    } else {
      logEntry.error = "Unsupported API mode: " + apiMode;
      logEntry.durationMs = Math.round(performance.now() - t0);
      pushLog(logEntry);
      return { error: "Unsupported API mode: " + apiMode, data: null };
    }

    logEntry.durationMs = Math.round(performance.now() - t0);

    if (!response.ok) {
      const errText = await response.text();
      logEntry.error = `API error ${response.status}: ${errText}`;
      pushLog(logEntry);
      return { error: `API error ${response.status}: ${errText}`, data: null };
    }

    const data = await response.json();
    logEntry.response = data;
    pushLog(logEntry);
    return { error: null, data };
  } catch (err: any) {
    logEntry.error = err.message || String(err);
    logEntry.durationMs = Math.round(performance.now() - t0);
    pushLog(logEntry);
    return { error: err.message || String(err), data: null };
  }
}

/** Extract text content from an Anthropic Messages API response. */
export function extractText(data: any): string {
  if (!data?.content) return "";
  const textBlock = data.content.find((b: any) => b.type === "text");
  return textBlock?.text || "";
}

/** Extract a tool_use block by name from an Anthropic Messages API response. */
export function extractToolUse(data: any, toolName: string): any | null {
  if (!data?.content) return null;
  const block = data.content.find(
    (b: any) => b.type === "tool_use" && b.name === toolName,
  );
  return block?.input ?? null;
}
