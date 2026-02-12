/**
 * Seed: /src/main.tsx — Entry point.
 * Guards createRoot for hot reload, registers AgentModule, mounts AgentMount.
 */

export const SEED_MAIN_SOURCE = `import React from "react";
import { createRoot } from "react-dom/client";
import { AgentMount } from "./agent-mount";
import Agent from "./agent";

declare global {
  interface Window {
    __RUNTIME__?: any;
    __AGENT_STATE__?: any;
  }
}

window.__RUNTIME__.AgentModule = { default: Agent };

const el = document.getElementById("root")!;
const root = (window.__RUNTIME__.root ??= createRoot(el));

if (!window.__RUNTIME__._mounted) {
  root.render(
    React.createElement(AgentMount, {
      agentPath: "/src/agent.tsx",
    })
  );
  window.__RUNTIME__._mounted = true;
}
`;