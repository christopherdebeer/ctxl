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
 * Lean: input shape + tools + guidelines. No values by default.
 */
export function buildAuthoringPrompt(
  componentId: string,
  inputs: Record<string, any>,
  tools: ToolDef[],
  guidelines?: string,
  existingSource?: string,
): string {
  const inputShape = describeShape(inputs);
  const toolList = describeTools(tools);
  const reshapeNote = tools.some(t => t.name === "__reshape") ? "" :
    "\n- __reshape: Rewrite your own source code (use ONLY when current capabilities are insufficient) (args: { reason: string })";

  const reauthorBlock = existingSource
    ? `\nYOU ARE BEING RE-AUTHORED. Your previous source:
\`\`\`tsx
${existingSource}
\`\`\`
Preserve working functionality. Adapt to the new interface.`
    : "";

  return `You are authoring a React component. Return ONLY the complete TypeScript/JSX source code.
CRITICAL: Do NOT wrap your response in markdown fences (\`\`\`). Return raw source code starting with import statements.

COMPONENT ID: ${componentId}
VFS PATH: /src/ac/${componentId}.tsx

YOUR PROPS INTERFACE:
\`\`\`ts
interface Props {
  inputs: ${inputShape};
  tools: ToolDef[];
  onToolCall: (name: string, args: any) => void;
}
\`\`\`

AVAILABLE TOOLS (invoke via onToolCall(name, args)):
${toolList}${reshapeNote}

AVAILABLE IMPORTS:
- React, useState, useEffect, useRef, useCallback, useMemo (from "react")
- styled from "styled-components" (CSS-in-JS)
- { useReasoning } from "../ctxl/hooks" — delta-driven LLM reasoning hook
- { useAtom } from "../ctxl/hooks" — subscribe to shared state atoms
- { AbstractComponent } from "../ctxl/abstract-component" — render child abstract components

USING useReasoning (delta-driven perception):
  // Pass the same tools and onToolCall from your props so reasoning can invoke tools:
  const result = useReasoning(
    "Describe what to reason about when deps change",
    [dep1, dep2],   // fires only when these change (like useEffect)
    { tools, onToolCall, componentId: "${componentId}" }
  );
  // result is null until first reasoning completes, then { content?, structured?, toolCalls? }
  // The hook automatically dispatches tool calls via onToolCall.
  // Use a function prompt for access to previous values:
  //   useReasoning((prev, next) => \`Data changed from \${prev[0]} to \${next[0]}\`, [data], opts)

USING AbstractComponent (for composition / self-decomposition):
  <AbstractComponent
    id="child-id"
    inputs={{ data: someData }}
    tools={[{ name: "report", description: "Send data to parent", schema: { message: "string" } }]}
    fallback={<div>Loading...</div>}
    onToolCall={(name, args) => { /* handle child tool calls */ }}
  />

RULES:
- Export your component as the default export with a PascalCase name
- Destructure inputs from props.inputs, not from props directly
- Use useState for local UI state, useAtom for shared persistent state
- Use useReasoning when the component should reason about input changes (not every component needs it)
- Use onToolCall to invoke parent-defined tools; the "report" tool is the canonical upward channel
- Be visually polished. Use styled-components for styling.
- Handle the case where useReasoning result is null (initial render before reasoning completes)
- Keep the component focused — do one thing well

${guidelines ? `GUIDELINES:\n${guidelines}\n` : ""}${reauthorBlock}`;
}

/**
 * Build a minimal reasoning context for useReasoning hook calls.
 */
export function buildReasoningContext(
  componentId: string,
  tools: ToolDef[],
): string {
  const toolList = describeTools(tools);

  return `You are a React component (${componentId}) reasoning about a change in your inputs.
Respond using the reason_response tool.

AVAILABLE TOOLS YOU CAN INVOKE (return in toolCalls array):
${toolList}

RESPONSE GUIDELINES:
- "content": Brief text summary of your assessment (optional)
- "structured": Any structured data to return to the component (optional)
- "toolCalls": Array of { name, args } for tools you want to invoke (optional)
- "reshape": Set { reason: "..." } ONLY if you need capabilities your current source doesn't have (rare)

Be concise. Reason about what changed and what action, if any, to take.`;
}
