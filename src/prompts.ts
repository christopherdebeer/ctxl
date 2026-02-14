/**
 * System prompts for AbstractComponent authoring and reasoning.
 */
import type { ToolDef } from "./types";

/** Derive a lightweight TypeScript shape description from an object. */
function describeShape(obj: Record<string, any>): string {
  const entries = Object.entries(obj).map(([key, val]) => {
    if (val === null || val === undefined) return `  ${key}: any`;
    if (Array.isArray(val)) {
      if (val.length === 0) return `  ${key}: any[]`;
      return `  ${key}: ${typeof val[0]}[]`;
    }
    return `  ${key}: ${typeof val}`;
  });
  return `{\n${entries.join(";\n")};\n}`;
}

function describeTools(tools: ToolDef[]): string {
  return tools.map(t => {
    let line = `- ${t.name}: ${t.description}`;
    if (t.schema) {
      const fields = Object.entries(t.schema).map(([k, v]) => `${k}: ${v}`).join(", ");
      line += ` (args: { ${fields} })`;
    }
    return line;
  }).join("\n");
}

/**
 * Build the system prompt for authoring a new AbstractComponent.
 * Lean: input shape + tools + handlers + guidelines. No values by default.
 */
export function buildAuthoringPrompt(
  componentId: string,
  inputs: Record<string, any>,
  tools: ToolDef[],
  handlers?: Record<string, string>,
  guidelines?: string,
  existingSource?: string,
): string {
  const inputShape = describeShape(inputs);
  const toolList = describeTools(tools);
  const reshapeNote = tools.some(t => t.name === "__reshape") ? "" :
    "\n- __reshape: Rewrite your own source code to better handle the current situation (args: { reason: string }). When uncertain, prefer reshaping and composing child AbstractComponents over doing nothing.";

  const handlerEntries = handlers ? Object.entries(handlers) : [];
  const handlerBlock = handlerEntries.length > 0
    ? `\nHANDLERS (implementation callbacks — wire these into your UI via props.handlers):\n${handlerEntries.map(([k, desc]) => `- props.handlers.${k}: ${desc}`).join("\n")}\n`
    : "";

  const handlerShape = handlerEntries.length > 0
    ? `  handlers: {\n${handlerEntries.map(([k]) => `    ${k}: (...args: any[]) => any`).join(";\n")};\n  }`
    : "  handlers: Record<string, never>";

  const reauthorBlock = existingSource
    ? `\nYOU ARE BEING RE-AUTHORED. Your previous source:
\`\`\`tsx
${existingSource}
\`\`\`
Preserve working functionality where applicable. Adapt confidently to the new interface — when uncertain about details, make your best judgment and compose child AbstractComponents for sub-problems.`
    : "";

  return `You are authoring a React component. Use the write_component tool to deliver the source code.

COMPONENT ID: ${componentId}
VFS PATH: /src/ac/${componentId}.tsx

YOUR PROPS INTERFACE:
\`\`\`ts
interface Props {
  inputs: ${inputShape};
${handlerShape};
}
\`\`\`

AGENT TOOLS (automatically available to useReasoning — do NOT pass manually):
${toolList}${reshapeNote}
These tools are dispatched by useReasoning's multi-turn agent loop. You do not need to handle them.
${handlerBlock}
AVAILABLE IMPORTS:
- React, useState, useEffect, useRef, useCallback, useMemo (from "react")
- styled from "styled-components" (CSS-in-JS)
- { useReasoning } from "../ctxl/hooks" — delta-driven LLM reasoning hook
- { useAtom } from "../ctxl/hooks" — subscribe to shared state atoms
- { AbstractComponent } from "../ctxl/abstract-component" — render child abstract components

USING useReasoning (delta-driven perception):
  // Parent tools are automatically available. Just specify componentId:
  const result = useReasoning(
    "Describe what to reason about when deps change",
    [dep1, dep2],   // fires only when these change (like useEffect)
    { componentId: "${componentId}" }
  );
  // result is null until first reasoning completes, then { content?, structured?, reshape? }
  // The hook sends parent+local tools as real API tools and auto-dispatches calls.
  // To add component-local tools for reasoning:
  //   useReasoning("...", [deps], {
  //     tools: [{ name: "sort", description: "Sort data", handler: (args) => setSortDir(args.dir) }],
  //     componentId: "${componentId}",
  //   })
  // Use a function prompt for access to previous values:
  //   useReasoning((prev, next) => \`Data changed from \${prev[0]} to \${next[0]}\`, [data], opts)

USING AbstractComponent (for composition / self-decomposition):
  <AbstractComponent
    id="child-id"
    inputs={{ data: someData }}
    tools={[{ name: "report", description: "Send data to parent", schema: { message: "string" }, handler: (args) => handleReport(args) }]}
    handlers={{
      onChange: { description: "Called when settings change", fn: (config) => setConfig(config) },
    }}
    fallback={<div>Loading...</div>}
  />

RULES:
- Export your component as the default export with a PascalCase name
- Destructure inputs from props.inputs, not from props directly
- Use useState for local UI state, useAtom for shared persistent state
- Use useReasoning when the component should reason about input changes (not every component needs it)
- Use props.handlers for implementation callbacks (UI wiring)
- Be visually polished. Use styled-components for styling.
- Handle the case where useReasoning result is null (initial render before reasoning completes)
- Keep the component focused — do one thing well

${guidelines ? `GUIDELINES:\n${guidelines}\n` : ""}${reauthorBlock}`;
}

/**
 * Build reasoning context for useReasoning hook calls.
 *
 * Note: The VFS seed (seeds/ctxl/hooks.ts) has its own inline
 * buildSystemContext that includes runtime inspection (atoms, siblings,
 * component source). This host-side version is kept in sync for any
 * future host-side reasoning callers.
 */
export function buildReasoningContext(
  componentId: string,
  tools: ToolDef[],
): string {
  const toolList = describeTools(tools);

  return `You are a React component (${componentId}) reasoning about a change in your inputs. Your render output is your body — your expression to the world. You reason about input changes and take action through tools.

AVAILABLE TOOLS:
${toolList}
- __reshape: Rewrite your own source code to better handle the current situation (args: { reason: string }). Prefer composing child AbstractComponents for sub-problems.

INSTRUCTIONS:
- Examine the input values and reason about what changed and what action to take.
- Call tools to take action. Use __reshape when your current source cannot handle what's needed.
- When done, call reason_response with your final assessment.
- reason_response fields: content (brief text summary), structured (any data for the component), reshape ({ reason } to request source rewrite).
- Be concise. Prefer action over inaction — child AbstractComponents can handle sub-problems.`;
}
