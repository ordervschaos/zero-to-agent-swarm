import { readFileSync, existsSync } from "fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { startRepl, startFileWatcher, startClock, startPoll } from "./triggers.js";
import { setActiveAgent } from "./tools.js";
import { showStartup } from "./display.js";
import { setRunId, setEventAgent, logEvent } from "./events.js";

const agentName = process.env.AGENT_NAME || process.argv[2] || "default";

// Handle --list flag
if (agentName === "--list") {
  console.log("Available agents:");
  for (const name of listAgents()) console.log(`  - ${name}`);
  process.exit(0);
}

const config = loadAgentConfig(agentName);
initMemory(config);
setActiveAgent(agentName);

// Observability: each process gets a run ID; all share the agent name for log attribution.
const runId = `run-${Date.now().toString(36)}`;
setRunId(runId);
setEventAgent(agentName);
logEvent("agent_started", { description: config.description });

const agent = new Agent(config);
showStartup(config.name, config.description);

if (config.triggers.fileWatcher) {
  startFileWatcher((source, message) => agent.act(source, message));
}
if (config.triggers.clock) {
  startClock((source, message) => agent.act(source, message));
}
if (config.triggers.poll) {
  startPoll((source, message) => agent.act(source, message));
}
if (config.triggers.repl) {
  startRepl((source, message) => agent.act(source, message));
}
