import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { startRepl, startFileWatcher, startClock } from "./triggers.js";

// Determine which agent to start: AGENT_NAME env var or CLI arg, default "default"
const agentName = process.env.AGENT_NAME || process.argv[2] || "default";

// Handle --list flag
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
