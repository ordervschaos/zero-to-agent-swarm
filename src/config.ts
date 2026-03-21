import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  maxIterations?: number;
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
  const configPath = path.join(AGENTS_DIR, agentName, "genome.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Agent config not found: ${configPath}`);
    console.error(`Available agents:`);
    for (const name of listAgents()) console.error(`  - ${name}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

export function listAgents(): string[] {
  return fs
    .readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(AGENTS_DIR, e.name, "genome.json")))
    .map((e) => e.name);
}
