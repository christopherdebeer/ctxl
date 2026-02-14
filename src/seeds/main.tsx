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
  // Wrap the tree in RuntimeContext.Provider — dogfooding the same context
  // that library consumers use via <CtxlProvider>.
  const runtimeCtx = { runtime: window.__RUNTIME__, atoms: window.__ATOMS__ };

  root.render(
    React.createElement(RuntimeContext.Provider, { value: runtimeCtx },
      React.createElement(AbstractComponent, {
        id: "root",
        inputs: {},
        tools: [
          {
            name: "set_objective",
            description: "Set the user's chosen objective via reasoning. Persists across sessions.",
            schema: { objective: "string" },
            handler: (args: any) => {
              const atoms = window.__ATOMS__;
              const atom = atoms?.create("objective", "");
              atom?.set(args.objective);
              return "Objective set: " + args.objective;
            },
          },
          {
            name: "report",
            description: "Report status or observations to the system",
            schema: { message: "string" },
            handler: (args: any) => { console.log("[root] report:", args); return "reported"; },
          },
        ],
        handlers: {
          setObjective: {
            description: "Set the user's objective directly (called from UI interactions like button clicks). Persists to atoms.",
            fn: (objective: string) => {
              const atoms = window.__ATOMS__;
              const atom = atoms?.create("objective", "");
              atom?.set(objective);
            },
          },
        },
        guidelines: `You are the root component of ctxl — a tool for making tools.

REACTIVE STATE:
Use useAtom("objective", "") to subscribe to the objective. This is LIVE — it updates when the user sets an objective.
Do NOT rely on props.inputs for the objective — it's static. Use useAtom for reactive state.

FIRST VISIT (objective is empty):
Present meaningful invitations — not a blank input field or chat box. Offer starting points:
- "Make a tool" — help the user build something useful
- "Get something done" — focus on a specific task
- "Explore" — open-ended discovery
- "Learn something" — guided exploration through building

When the user clicks an invitation or submits custom text, call props.handlers.setObjective(text) DIRECTLY.
This is a handler, not a reasoning tool — it fires immediately without LLM latency.
Example: onClick={() => props.handlers.setObjective("I want to make a tool for tracking habits")}

RETURNING VISIT (objective is non-empty):
Show the objective and decompose into a workspace with child AbstractComponents.
Let the user change the objective if needed (call props.handlers.setObjective with the new value).

DESIGN PRINCIPLES:
- Use useAtom("objective", "") for reactive objective state — this is the source of truth
- Call props.handlers.setObjective(text) for immediate UI actions (button clicks, form submits)
- The set_objective tool is for reasoning-initiated changes — the handler is for direct user actions
- Use useReasoning for ongoing adaptation (what to show, how to decompose the workspace)
- Decompose into child AbstractComponents — don't try to do everything in the root
- Use styled-components for a dark, minimal aesthetic
- Be welcoming without being cloying. Direct, not chatty.
- Include a text input for custom objectives
- Use useEngagement to track which sections the user interacts with`,
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
