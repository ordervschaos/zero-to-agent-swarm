import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents, setActiveAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { startRepl, startFileWatcher, startClock } from "./triggers.js";
import { enqueue, clearAll } from "./task-queue.js";
import { onSummary } from "./summary.js";
import { startDashboard, pushSummary } from "./dashboard.js";

// ── Which mode? ──────────────────────────────────────────────────────
// "swarm" mode:  SWARM_AGENTS=coder,writer npm run dev
// "solo" mode:   npm run dev  (or AGENT_NAME=researcher npm run dev)
const swarmList = process.env.SWARM_AGENTS;

if (swarmList) {
  // ── Swarm mode ──────────────────────────────────────────────────────
  const agentNames = swarmList.split(",").map((s) => s.trim());
  setActiveAgents(agentNames);
  const defaultTarget = agentNames.includes("orchestrator") ? "orchestrator" : agentNames[0];

  const onInput = (message: string) => {
    // Built-in commands
    if (message === "/clear") {
      clearAll();
      return;
    }

    const colonIdx = message.indexOf(":");
    if (colonIdx > 0) {
      const target = message.slice(0, colonIdx).trim().toLowerCase();
      const task = message.slice(colonIdx + 1).trim();
      if (agentNames.includes(target)) {
        enqueue(task, target);
        return;
      }
    }
    enqueue(message, defaultTarget);
  };

  // Start dashboard FIRST so it captures all log output
  startDashboard(onInput);
  onSummary((summary) => {
    pushSummary(summary);
    console.log(`Project complete: "${summary.project}"`);
    for (const sub of summary.subtasks) {
      console.log(`  ${sub.agent}: ${sub.description} → ${sub.result.slice(0, 80)}`);
    }
  });

  const agents: Agent[] = [];
  for (const name of agentNames) {
    const config = loadAgentConfig(name);
    initMemory(config);
    const agent = new Agent(config);
    agents.push(agent);
    console.log(`[swarm] spawned "${name}" (${config.description})`);
  }

  for (const agent of agents) {
    agent.startPolling();
  }

  if (process.env.WATCH_DIR) {
    startFileWatcher(async (_source, message) => { onInput(message); });
  }
  if (process.env.CRON_SCHEDULE) {
    startClock(async (_source, message) => { onInput(message); });
  }

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

  // In solo mode, print summaries to console
  onSummary((summary) => {
    console.log(`\n${summary.project}`);
    for (const sub of summary.subtasks) {
      console.log(`  ${sub.agent}: ${sub.description} → ${sub.result}`);
    }
  });

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
