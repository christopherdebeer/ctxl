/**
 * LLM transport — single fetch function supporting Anthropic direct and proxy modes.
 *
 * Accepts arbitrary extra body fields (tools, tool_choice, etc.)
 * so callers don't need to duplicate the fetch plumbing.
 */
import type { RuntimeConfig } from "./types";

export interface LLMResponse {
  error: string | null;
  data: any;
}

export async function callLLM(
  config: RuntimeConfig,
  system: string,
  messages: Array<{ role: string; content: any }>,
  extras?: Record<string, any>,
): Promise<LLMResponse> {
  const { apiMode, apiKey, proxyUrl, model } = config;

  if (apiMode === "none") {
    return { error: "No API configured. Set API mode in settings.", data: null };
  }

  const body: Record<string, any> = {
    system,
    messages,
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    ...extras,
  };

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
      return { error: "Unsupported API mode: " + apiMode, data: null };
    }

    if (!response.ok) {
      const errText = await response.text();
      return { error: `API error ${response.status}: ${errText}`, data: null };
    }

    const data = await response.json();
    return { error: null, data };
  } catch (err: any) {
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
