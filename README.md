# Zero to Agent Swarm

A step-by-step tutorial for engineers who want to understand the agent ecosystem from first principles. We build a single agent from scratch, upgrade it with memory, containment, and autonomy, then multiply it into a coordinated swarm.

**[Start the tutorial](./tutorial_docs/tutorial.md)** | **[Quickstart](./quickstart.md)**

## The mental model

Every agent we build follows this formula:

> **Agent = Triggers → Loop(Thinking + Tools + Memory), inside a Container**

We start with nothing and add one piece at a time until the full model is running.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      TRIGGERS                           │
│                                                         │
│   ┌──────────┐    ┌──────────────┐    ┌─────────────┐   │
│   │   REPL   │    │ File Watcher │    │    Clock    │   │
│   │  (stdin) │    │ (workspace/) │    │   (cron)    │   │
│   └────┬─────┘    └──────┬───────┘    └──────┬──────┘   │
│        │                 │                    │         │
│        └─────────────────┼────────────────────┘         │
│                          ▼                              │
│  ┌ ─ ─ ─ ─ ─ ─ DOCKER CONTAINER ─ ─ ─ ─ ─ ─ ─ ─ - ┐     │
│                                                         │
│  │  ┌──────────────────────────────────────────┐  │     │
│     │              AGENT LOOP                  │        │
│  │  │                                          │  │     │
│     │  ┌─────────┐   ┌───────┐   ┌────────┐    │        │
│  │  │  │Thinking │──▶│ Tools │──▶│Observe │    │  │     │
│     │  │  (LLM)  │   │       │   │ Result │    │        │
│  │  │  └─────────┘   │·bash  │   └───┬────┘    │  │     │
│     │       ▲        │·files │       │         │        │
│  │  │       │        │·notes │       │         │  │     │
│     │       └────────┴───────┴─────-─┘         │        │
│  │  │                                          │  │     │
│     │  Done? ── yes ──▶ respond to user        │        │
│  │  │    └── no ──▶ loop again                 │  │     │
│     │                                          │        │
│  │  └──────────────────────────────────────────┘  │     │
│                                                         │
│  │  ┌──────────────────────────────────────────┐  │     │
│     │              MEMORY                      │        │
│  │  │  identity.md  ·  notes.md  ·  history    │  │     │
│     └──────────────────────────────────────────┘        │
│  │                                                │     │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ - -       │
└─────────────────────────────────────────────────────────┘
```

## Roadmap

| Phase | Goal | What you build |
|-------|------|----------------|
| **1. Birth** | Build a single agent from scratch | A local assistant that can explore your filesystem |
| **2. Upgrades** | Make it powerful and safe | Memory, a Docker container, bash, autonomy |
| **3. Swarm** *(coming soon)* | Run multiple agents together | Specialized agents coordinating on tasks |

## What you'll need

- Node.js 18+
- Docker (for Phase 2+)
- A Gemini API key (or any LLM provider — just swap the call)

Ready? **[Start the tutorial](./tutorial_docs/tutorial.md)** or jump straight to the **[Quickstart](./quickstart.md)**.
