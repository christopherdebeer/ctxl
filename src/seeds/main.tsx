/**
 * VFS SEED — imported as raw text, not compiled into the host bundle.
 *
 * This file is authored as normal TypeScript so it benefits from IDE
 * autocompletion and type-checking (via tsconfig.seeds.json), but at build
 * time Vite's `?raw` import injects its source text as a string into the
 * host bundle.  At runtime esbuild-wasm compiles it inside the browser as
 * part of the Virtual File System (VFS).
 *
 * VFS path:  /src/main.tsx
 * Registry:  src/seeds-v2.ts
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { AbstractComponent } from "./ctxl/abstract-component";
import { RuntimeContext } from "./ctxl/hooks";
import "./ac/_registry";

declare global {
  interface Window {
    __RUNTIME__?: any;
    __ATOMS__?: any;
    __COMPONENTS__?: Record<string, any>;
  }
}

const el = document.getElementById("root")!;
const root = (window.__RUNTIME__.root ??= createRoot(el));

if (!window.__RUNTIME__._mounted) {
  // Read objective from atoms or use default
  const atoms = window.__ATOMS__;
  const objectiveAtom = atoms?.create("objective", "");
  const objective = objectiveAtom?.get() || "";
  const isFirstVisit = !objective;

  // Wrap the tree in RuntimeContext.Provider — dogfooding the same context
  // that library consumers use via <CtxlProvider>.
  const runtimeCtx = { runtime: window.__RUNTIME__, atoms: window.__ATOMS__ };

  root.render(
    React.createElement(RuntimeContext.Provider, { value: runtimeCtx },
      React.createElement(AbstractComponent, {
        id: "root",
        inputs: { objective, isFirstVisit },
        tools: [
          {
            name: "set_objective",
            description: "Set the user's chosen objective. Persists across sessions.",
            schema: { objective: "string" },
            handler: (args: any) => {
              objectiveAtom.set(args.objective);
              return "Objective set: " + args.objective;
            },
          },
          {
            name: "report",
            description: "Report status or observations to the system",
            schema: { message: "string", type: "'info' | 'success' | 'warning'" },
            handler: (args: any) => { console.log("[root] report:", args); return "reported"; },
          },
        ],
        guidelines: `You are the root component of ctxl — a tool for making tools.

FIRST VISIT (isFirstVisit is true):
Present meaningful invitations — not a blank input field or chat box. Offer starting points that feel like genuine affordances:
- "Let's make a tool" — help the user build something useful for their work
- "Get something done" — focus on a specific task the user describes
- "Explore" — open-ended discovery of what's possible
- "Learn something" — guided exploration of a topic through building

Each invitation should lead to structure: when chosen, use set_objective to persist it, then decompose into a workspace with child AbstractComponents. The invitations are prompts in the creative sense — they scaffold the user from "I have a vague idea" to "I have a working thing."

RETURNING VISIT (isFirstVisit is false):
The user has an objective. Decompose it into a workspace. Show progress. Let the user reshape the objective if needed.

DESIGN PRINCIPLES:
- The interface should be generative: suggest, scaffold, show what's possible
- Use useReasoning to adapt based on what the user does (not just what they say)
- Decompose into child AbstractComponents — don't try to do everything in the root
- Use styled-components for a dark, minimal aesthetic
- Be welcoming without being cloying. Direct, not chatty.
- Include an input for the user to describe what they want in their own words
- Use useEngagement to track which invitations/sections the user interacts with`,
        fallback: React.createElement("div", {
          style: {
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", fontFamily: "system-ui", color: "#888",
            background: "#0a0a0a",
          }
        },
          React.createElement("div", { style: { textAlign: "center" } },
            React.createElement("div", {
              style: {
                fontSize: "48px", marginBottom: "16px", opacity: 0.3,
              }
            }, "\u2726"),
            React.createElement("div", { style: { fontSize: "14px" } }, "Authoring root component..."),
          ),
        ),
      }),
    )
  );
  window.__RUNTIME__._mounted = true;
}
