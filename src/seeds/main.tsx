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
  const objectiveAtom = atoms?.get("objective");
  const objective = objectiveAtom?.get() || "What would you like to build?";

  root.render(
    React.createElement(AbstractComponent, {
      id: "root",
      inputs: { objective },
      tools: [
        { name: "report", description: "Report status to the system", handler: (args) => { console.log("[root] report:", args); return "reported"; } },
      ],
      guidelines: "You are the root component. Present a clean interface for the user to describe what they want to build. Decompose objectives into child AbstractComponents when appropriate. Be welcoming and visually polished.",
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
    })
  );
  window.__RUNTIME__._mounted = true;
}
