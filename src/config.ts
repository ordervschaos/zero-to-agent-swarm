import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentConfig {
  name: string;
  description: string;
  identity: string;
  tools: string[];
  triggers: {
    repl: boolean;
    fileWatcher: boolean;
    clock: boolean;
  };
}

const AGENTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "agents"
);

export function loadAgentConfig(agentName: string): AgentConfig {
  const configPath = path.join(AGENTS_DIR, `${agentName}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Agent config not found: ${configPath}`);
    console.error(`Available agents:`);
    const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) console.error(`  - ${path.basename(f, ".json")}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/** Active swarm agents (set in swarm mode). When empty, all on-disk agents are returned. */
let activeAgents: string[] = [];

/** Register the agents that are actually running in this swarm. */
export function setActiveAgents(names: string[]): void {
  activeAgents = [...names];
}

/** List available agents. In swarm mode returns only active agents; otherwise all on disk. */
export function listAgents(): string[] {
  if (activeAgents.length > 0) return activeAgents;
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}
