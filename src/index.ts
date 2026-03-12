import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { startRepl, startFileWatcher, startClock } from "./triggers.js";
import { enqueue } from "./task-queue.js";
import type { TriggerSource } from "./triggers.js";

// ── Which mode? ──────────────────────────────────────────────────────
// "swarm" mode:  SWARM_AGENTS=coder,writer npm run dev
// "solo" mode:   npm run dev  (or AGENT_NAME=researcher npm run dev)
const swarmList = process.env.SWARM_AGENTS;

if (swarmList) {
  // ── Swarm mode ──────────────────────────────────────────────────────
  const agentNames = swarmList.split(",").map((s) => s.trim());
  const agents: Agent[] = [];

  for (const name of agentNames) {
    const config = loadAgentConfig(name);
    initMemory(config);
    const agent = new Agent(config);
    agents.push(agent);
    console.log(`  [swarm] spawned agent "${name}" (${config.description})`);
  }

  // Watchers enqueue tasks directly — no task manager yet.
  // User specifies which agent via "agent: message" format.
  const onTrigger = async (_source: TriggerSource, message: string) => {
    // Parse "agentName: task description" format
    const colonIdx = message.indexOf(":");
    if (colonIdx > 0) {
      const target = message.slice(0, colonIdx).trim().toLowerCase();
      const task = message.slice(colonIdx + 1).trim();
      if (agentNames.includes(target)) {
        enqueue(task, target);
        return;
      }
    }
    // No agent prefix — enqueue to first agent by default
    enqueue(message, agentNames[0]);
  };

  startRepl(onTrigger);

  if (process.env.WATCH_DIR) startFileWatcher(onTrigger);
  if (process.env.CRON_SCHEDULE) startClock(onTrigger);

  // Each agent polls the shared queue.
  for (const agent of agents) {
    agent.startPolling();
  }

  console.log(`\nSwarm ready — ${agents.length} agents polling.`);
  console.log(`Type "agentName: task" to assign, or just type to send to ${agentNames[0]}.\n`);
} else {
  // ── Solo mode (original behavior) ───────────────────────────────────
  const agentName = process.env.AGENT_NAME || process.argv[2] || "default";

  if (agentName === "--list") {
    console.log("Available agents:");
    for (const name of listAgents()) console.log(`  - ${name}`);
    process.exit(0);
  }

  const config = loadAgentConfig(agentName);
  initMemory(config);

  const agent = new Agent(config);

  console.log(`Agent "${config.name}" started. (${config.description})`);

  if (config.triggers.fileWatcher) {
    startFileWatcher((source, message) => agent.act(source, message));
  }
  if (config.triggers.clock) {
    startClock((source, message) => agent.act(source, message));
  }
  if (config.triggers.repl) {
    startRepl((source, message) => agent.act(source, message));
  }
}
