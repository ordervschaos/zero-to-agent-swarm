# Zero to Agent Swarm

A step-by-step tutorial for engineers who want to understand the agent ecosystem from first principles. We build a single agent from scratch, upgrade it with memory, containment, and autonomy, then multiply it into a coordinated swarm.

![](tutorial_docs/images/demo.gif)


**[Start the tutorial](./tutorial_docs/tutorial.md)** | **[Quickstart](./quickstart.md)**

## The mental model

Every agent we build follows this formula:

> **Agent = Triggers → Loop(Thinking + Tools + Memory), inside a Container**


<img width="1669" height="799" alt="image" src="https://github.com/user-attachments/assets/ec518c4f-31ad-489d-8f91-5ee7016f98d0" />


We start with nothing and add one piece at a time until the full model is running.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         TRIGGERS                                 │
│   ┌──────────┐    ┌──────────────┐    ┌─────────────┐            │
│   │   REPL   │    │ File Watcher │    │    Clock    │            │
│   └────┬─────┘    └──────┬───────┘    └──────┬──────┘            │
│        └─────────────────┼────────────────────┘                  │
│                          ▼                                       │
│  ┌ ─ ─ ─ ─ ─ ─ DOCKER CONTAINER ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│                                                                  │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│     │                  AGENT LOOP                        │      │
│  │  │  ┌─────────┐   ┌──────────────┐   ┌────────┐      │  │   │
│     │  │Thinking │──▶│    Tools     │──▶│Observe │      │      │
│  │  │  │  (LLM)  │   │ ·bash        │   │ Result │      │  │   │
│     │  └─────────┘   │ ·files       │   └───┬────┘      │      │
│  │  │       ▲        │ ·notes       │       │           │  │   │
│     │       └────────│ ·ask_agent   │───────┘           │      │
│  │  │                │ ·post_task   │                   │  │   │
│     │                │ ·workspace   │                   │      │
│  │  └────────────────────────────────────────────────────┘  │   │
│                                                                  │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│     │  MEMORY: identity.md · notes.md · history          │      │
│  │  └────────────────────────────────────────────────────┘  │   │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│                          │ ask_agent / workspace                 │
│                          ▼                                       │
│  ┌────────────┐  ┌───────────────┐  ┌──────────┐                │
│  │  manager   │  │   researcher  │  │  coder   │  ···           │
│  └────────────┘  └───────────────┘  └──────────┘                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  GLOBAL WORKSPACE: tasks.json · artifacts.json           │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

## Roadmap

| Phase | Goal | What you build |
|-------|------|----------------|
| **1. Birth** | Build a single agent from scratch | A local assistant that can explore your filesystem |
| **2. Upgrades** | Make it powerful and safe | Memory, a Docker container, bash, autonomy |
| **3. Swarm** | Run multiple agents together | Specialized agents coordinating on tasks via a global workspace |

## Project layout

```
src/              # Agent runtime (TypeScript)
  index.ts        # Entry point — loads env, wires triggers
  agent.ts        # Agent class — agentic loop + delegation
  config.ts       # AgentConfig type, loads JSON genomes
  llm.ts          # Thin wrapper around @google/genai
  memory.ts       # Per-agent file-based memory
  tools.ts        # Tool declarations + executeTool dispatcher
  triggers.ts     # REPL, file watcher, clock triggers
  workspace.ts    # Global workspace — tasks + artifacts
  ui-server.ts    # HTTP server + SSE for the web dashboard
  display.ts      # Console output helpers
  log-events.ts   # Event bus for real-time UI streaming
agents/           # Agent genomes (JSON) + per-agent memory
  default/        # General-purpose assistant
  manager/        # Orchestrator — breaks work into tasks
  researcher/     # Research specialist
  coder/          # Code generation specialist
  writer/         # Documentation specialist
workspace/        # Shared coordination store
  tasks.json      # Task list (open → in_progress → done)
  artifacts.json  # Key-value store for inter-agent data
ui/               # Web dashboard (single HTML file)
tutorial_docs/    # Tutorial markdown + images
.claude/skills/   # Claude Code skill files (one per phase-step)
```

## What you'll need

- Node.js 18+
- Docker (for Phase 2+)
- A Gemini API key (or any LLM provider — just swap the call)

```bash
npm install
npm run start                    # run an agent (REPL mode)
AGENT_NAME=manager npm run start # run the manager agent
npm run ui                       # web dashboard at http://localhost:3000
```

Ready? **[Start the tutorial](./tutorial_docs/tutorial.md)** or jump straight to the **[Quickstart](./quickstart.md)**.
