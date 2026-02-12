/**
 * Default VFS seed files — Contextual paradigm.
 *
 * Each seed lives in its own file (seed-*.ts) for maintainability.
 * This module imports them and assembles the VFS seed map.
 */

import { SEED_MAIN_SOURCE } from "./seed-main";
import { SEED_USE_AGENT_STATE_SOURCE } from "./seed-use-agent-state";
import { SEED_AGENT_MOUNT_SOURCE } from "./seed-agent-mount";
import { SEED_AGENT_SOURCE } from "./seed-agent";

export const DEFAULT_SEEDS: Map<string, string> = new Map([
  ["/src/main.tsx", SEED_MAIN_SOURCE],
  ["/src/useAgentState.ts", SEED_USE_AGENT_STATE_SOURCE],
  ["/src/agent-mount.tsx", SEED_AGENT_MOUNT_SOURCE],
  ["/src/agent.tsx", SEED_AGENT_SOURCE],
]);