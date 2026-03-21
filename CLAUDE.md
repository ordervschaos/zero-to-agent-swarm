# Zero to Agent Swarm Tutorial

A step-by-step guide to building a multi-agent system with Node.js and Claude.

## Tech Stack

- **Runtime:** Node.js + TypeScript (via `tsx`, no build step in dev)
- **LLM:** Gemini 2.0 Flash (`@google/genai`) — requires `GEMINI_API_KEY`
- **Isolation:** Docker (recommended) — agent runs bash tools in container
- **Memory:** File-based per-agent (`agents/<name>/notes.md`, `agents/<name>/identity.md`)
- **Coordination:** Global workspace (`workspace/tasks.json`, `workspace/artifacts.json`)

## Project Layout

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
agents/           # Agent genomes (JSON) + per-agent memory (md files)
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

See `src/CLAUDE.md` for a module-by-module breakdown of the runtime.

## Skills

The tutorial is structured as a series of interactive skills:

| Skill | Phase | Concept |
|-------|-------|---------|
| `/phase-1-step-1-make-it-talk` | 1 | HTTP server and basic Claude API integration |
| `/phase-1-step-2-make-it-think` | 1 | Tool use and Claude decision-making |
| `/phase-1-step-3-another-tool` | 1 | Multiple tools and routing |
| `/phase-1-step-4-decision-loop` | 1 | Agentic loops and state management |
| `/phase-2-step-1-better-memory` | 2 | Persistent memory and SQLite |
| `/phase-2-step-2-containment` | 2 | Container isolation and IPC |
| `/phase-2-step-3-more-tools` | 2 | Expanding agent capabilities |
| `/phase-2-step-4-more-triggers` | 2 | File watchers and event loops |
| `/phase-3-step-1-agent-replication` | 3 | Configurable agents from JSON genomes |
| `/phase-3-step-2-delegation` | 3 | Agent-to-agent delegation via ask_agent tool |
| `/phase-3-step-3-global-workspace` | 3 | Global workspace — shared tasks and artifacts |
| `/phase-3-step-3-5-web-ui` | 3.5 | Real-time web dashboard via SSE |
| `/phase-4-step-1-dag-execution` | 4 | DAG task graph — parallel + serial execution |

Run any skill to continue your journey: `/phase-1-step-1-make-it-talk` to start from the beginning, or skip ahead to where you left off.

## Development Workflow

Each stage follows a 3-step pattern:
1. **Code** — implement the feature and commit
2. **Skill** — create/update `.claude/skills/phase-N-step-N-<name>.skill`
3. **Tutorial doc** — create/update `tutorial_docs/phase-N-step-N.md`

## Tutorial Doc Conventions

Each tutorial doc should include (per `tutorial_docs/CLAUDE.md`):
- What you'll learn
- The big idea
- Steps
- How to try it

To link a doc to a specific code state, use git tags:
```bash
git tag phase-1-step-1 <commit-hash>
git push origin phase-1-step-1
```

## Quick Start

```bash
npm install
npm run start      # run an agent (AGENT_NAME=manager npm run start)
npm run ui         # web dashboard at http://localhost:3000
```

See [quickstart.md](quickstart.md) for Docker setup and trigger configuration.
