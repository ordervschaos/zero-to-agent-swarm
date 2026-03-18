import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentConfig {
  name: string;
  description: string;
  identity: string;
  tools: string[];
  maxIterations?: number;
  triggers: {
    repl: boolean;
    fileWatcher: boolean;
    clock: boolean;
    poll?: boolean;
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

export function listAgents(): string[] {
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}
