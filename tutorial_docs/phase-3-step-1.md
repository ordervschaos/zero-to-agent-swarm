# Phase 3, Step 1: Agent Replication — Same Code, Different Agent

## What changed from Phase 2

The agent is no longer a singleton. Instead of one hardcoded identity/toolset, agents are now **defined by config files** — JSON documents that specify who the agent is, what it can do, and how it wakes up. The code is generic; the config makes it specific.

## What was added

1. **`agents/` directory** — Each `.json` file is an agent config (its "genome"). Ships with two: `default.json` and `researcher.json`
2. **`src/config.ts`** — `AgentConfig` interface and loader. Reads configs from `agents/`, validates they exist, and can list all available agents
3. **Per-agent memory** — Each agent gets its own `memory/<name>/` directory with `identity.md` and `notes.md`. Agents don't share notes
4. **Tool registry** — Tools are registered by name in a map. Each agent config lists which tools it wants; the Agent class picks only those
5. **Config-driven triggers** — Each agent config declares which triggers are active. A research agent might only want the REPL; a monitoring agent might only want the clock

## The agent config (genome)

```json
{
  "name": "researcher",
  "description": "Research agent that gathers and organizes information",
  "identity": "You are a research assistant. Be thorough but concise.",
  "tools": ["bash", "save_note"],
  "triggers": {
    "repl": true,
    "fileWatcher": false,
    "clock": false
  }
}
```

This is everything the system needs to spin up a distinct agent. Same codebase, different config = different agent.

## How agent selection works

```
AGENT_NAME env var  ──┐
CLI argument        ──┤──▶  loadAgentConfig(name)  ──▶  Agent(config)
default: "default"  ──┘           │
                                  ▼
                          agents/<name>.json
```

Three ways to select:
```bash
npm start                        # starts "default"
npm start researcher             # starts "researcher"
AGENT_NAME=researcher npm start  # same, via env var
```

## Key code

### Config loader (`src/config.ts`)

```typescript
export interface AgentConfig {
  name: string;
  description: string;
  identity: string;
  tools: string[];
  triggers: { repl: boolean; fileWatcher: boolean; clock: boolean };
}

export function loadAgentConfig(agentName: string): AgentConfig {
  const configPath = path.join(AGENTS_DIR, `${agentName}.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
```

### Tool filtering (`src/tools.ts`)

```typescript
const toolRegistry: Record<string, FunctionDeclaration> = {
  bash: bashDeclaration,
  save_note: saveNoteDeclaration,
};

export function getDeclarations(toolNames: string[]): FunctionDeclaration[] {
  return toolNames.map((name) => toolRegistry[name]).filter(Boolean);
}
```

### Agent construction (`src/agent.ts`)

```typescript
constructor(config: AgentConfig) {
  this.config = config;
  this.tools = [{ functionDeclarations: getDeclarations(config.tools) }];
}
```

### Startup (`src/index.ts`)

```typescript
const agentName = process.env.AGENT_NAME || process.argv[2] || "default";
const config = loadAgentConfig(agentName);
initMemory(config);
const agent = new Agent(config);

if (config.triggers.fileWatcher) startFileWatcher(...);
if (config.triggers.clock) startClock(...);
if (config.triggers.repl) startRepl(...);
```

## Per-agent memory layout

```
memory/
├── default/
│   ├── identity.md    ← bootstrapped from config.identity on first run
│   └── notes.md       ← this agent's accumulated notes
└── researcher/
    ├── identity.md
    └── notes.md
```

Each agent's identity is seeded from its config on first run, then lives as a file the agent (or you) can edit. Notes are private to each agent.

## Docker usage

```bash
# Spin up the default agent
docker compose run --rm agent

# Spin up a specific agent
AGENT_NAME=researcher docker compose run --rm agent
```

The `agents/` directory is mounted into the container, so you can add new agent configs without rebuilding.

## Creating a new agent

Just add a JSON file to `agents/`:

```bash
cat > agents/monitor.json << 'EOF'
{
  "name": "monitor",
  "description": "Watches workspace and reports changes",
  "identity": "You monitor the workspace for changes and log summaries.",
  "tools": ["bash", "save_note"],
  "triggers": {
    "repl": false,
    "fileWatcher": true,
    "clock": true
  }
}
EOF

AGENT_NAME=monitor npm start
```

No code changes needed. The genome defines the agent.

## Why this matters

This is the foundation of a swarm. You can't have multiple coordinating agents if every agent is the same. The genome pattern gives you:

- **Specialization** — each agent has exactly the tools and triggers it needs
- **Isolation** — each agent has its own memory, preventing cross-contamination
- **Scalability** — adding a new agent is adding a config file, not writing code
- **Docker-ready** — each agent can run in its own container with its own workspace

## What's next

Agents can now be different, but they can't see each other's work. Step 2 adds a **shared blackboard** — a SQLite database all agents can read and write — enabling coordination through shared state.
