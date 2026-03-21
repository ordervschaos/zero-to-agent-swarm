# Zero to Agent Swarm, Part 2: A Party of Agents

**[← Part 1: Birth and Upgrades](./tutorial.md)** — building a single agent from scratch.

---

Here's where the mental model shifts. So far we've been thinking about what an agent *is* — triggers, loop, tools, memory. Now we start thinking about what an agent *does* — the role it plays.

A coder. A writer. A researcher. These map naturally onto how we already think about work. Once you frame agents as roles, a lot of things click into place: why they need different tools, different memory, different authority. And why some of them need to talk to each other.

---

## 1. Spin up multiple agents — Same code, different agent

*Adding to the model: the **Genome** that defines each agent.*

One agent is useful. But real work often needs specialists — a researcher, a coder, a reviewer — each with their own **Tools**, **Memory**, and responsibilities. A single agent can context-switch between roles, but it loses focus. Dedicated agents stay sharp — and they can work in parallel.


What makes one agent different from another? Its **Thinking** (which model, what system prompt), its **Memory** (what it knows), its **Tools** (what it can do), its **Triggers** (what wakes it up), and its **Container** (what it can see). Package these together into a config — the agent's genome — and from one codebase you can spin up as many specialized agents as you need.

The agent is no longer a singleton. A JSON config file — the genome — declares an agent's identity, tools, triggers, and description. The `Agent` class reads this config and becomes whatever the genome says. Memory is per-agent (`memory/<name>/`), tools are filtered from a registry, and triggers are opt-in.

To create a new agent, add a JSON file to `agents/`. To start it: `AGENT_NAME=researcher npm start`. No code changes needed.

```
agents/
├── default.json       ← general-purpose assistant
└── researcher.json    ← research specialist
```

[Explanation](./phase-3-step-1.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-1) · [Skill](../.claude/skills/phase-3-step-1-agent-replication.skill)

---

## 2. Agent to agent delegation — The simplest possible multi-agent pattern

Agents can be different, but they still work alone. If the coder needs documentation, it has to write it itself. What if another agent can do it better and cheaper? Delegation is the natural next step.


The simplest way to achieve this is by allowing an agent to call another agent as a tool.


```
User → Coder
         ├── bash: writes calculator.py
         ├── ask_agent("writer", "write docs for calculator.py")
         │     └── Writer runs → returns docs
         └── delivers: "Built calculator + docs"
```

Here's what's actually happening under the hood — two agentic loops, one nested inside the other:

```
┌─────────────────────────────────────────────────────────┐
│  Coder's Loop                                           │
│                                                         │
│  User: "Build a calculator, then get someone to         │
│         write the docs"                                 │
│                                                         │
│  ┌─ Iteration 1 ──────────────────────────────────────┐ │
│  │  Think → "I need to write code first"              │ │
│  │  Tool  → bash: writes calculator.py                │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Iteration 2 ──────────────────────────────────────┐ │
│  │  Think → "Code done. User wants docs — delegate."  │ │
│  │  Tool  → ask_agent("writer", "write docs for       │ │
│  │           calculator.py")                           │ │
│  │                                                    │ │
│  │  ┌─ Writer's Loop (runs inside this tool call) ──┐ │ │
│  │  │  Think → "I need to read the file first"      │ │ │
│  │  │  Tool  → bash: cat calculator.py              │ │ │
│  │  │  Think → "Now I can write documentation"      │ │ │
│  │  │  Tool  → bash: writes calculator_docs.md      │ │ │
│  │  │  Think → "Done." → return result              │ │ │
│  │  └───────────────────────────────────────────────┘ │ │
│  │                                                    │ │
│  │  ← Writer returns: "Created calculator_docs.md"    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Iteration 3 ──────────────────────────────────────┐ │
│  │  Think → "Code + docs done. Deliver result."       │ │
│  │  Tool  → respond_to_user("Built calculator + docs")│ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

The key insight: `ask_agent` is just a tool. The coder's loop pauses on iteration 2, the writer's loop runs to completion, and then the coder's loop resumes with the result. Loops inside loops — the same pattern from Phase 1, just nested.

[Explanation](./phase-3-step-2.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-2-new) · [Skill](../.claude/skills/phase-3-step-2-delegation.skill)

---

## 3. Global Workspace — Shared state for agent coordination

*Adding to the model: a **Global Workspace** where agents coordinate through shared tasks and artifacts.*

Delegation is powerful, but it has a bottleneck: all information flows through the delegator. When the coder asks the researcher to analyze a codebase, the researcher's findings come back as a return value — and the coder has to relay them to the writer. The coder becomes a middleman, passing data it doesn't need to understand.

A **global workspace** solves this. It's a shared directory on disk with two coordination primitives:

- **Tasks** — a shared to-do list. The manager posts tasks, delegates to specialists who claim them, check progress, and keeps going until everything is done.
- **Artifacts** — a key-value store for data. Research findings, drafts, analysis — anything one agent produces that another might need.

### The manager loop

A **manager agent** drives the whole thing. Its identity is simple: break the goal into tasks, delegate each to a specialist, check progress, repeat until done. The manager never does the work itself — it orchestrates.

![](images/20260321124225.png)

The manager's loop has a higher iteration cap (`maxIterations: 25` in the genome) because it needs room to post tasks, delegate multiple times, and check progress between each delegation.

The workspace lives on disk:

```
workspace/
├── tasks.json       ← shared task list
└── artifacts.json   ← shared data store
```

Tasks have a simple lifecycle — `open` → `in_progress` → `done`:

```json
{
  "id": "task-001",
  "title": "implement calculator",
  "status": "done",
  "assignee": "coder",
  "postedBy": "manager",
  "result": "Created calculator.py with add, subtract, multiply, divide"
}
```

Five tools make it work:

| Tool | What it does |
|------|-------------|
| `post_task` | Add a task to the workspace |
| `list_tasks` | See tasks (filter by status) |
| `update_task` | Claim an open task or complete one |
| `write_artifact` | Store data under a key for other agents |
| `read_artifact` | Read data another agent left |

### Why this matters

Without the workspace, the manager has to micromanage everything:

```
ask_agent("writer", "Write docs for calculator.py. Here's the test output: [paste]. Here's the API: [paste].")
```

With the workspace, agents self-serve:

```
ask_agent("writer", "Check the workspace for open tasks and pick up what you can.")
```

The writer checks `list_tasks`, claims a task, reads artifacts for context, does the work, and marks it done. The manager doesn't relay data — it just points agents at the workspace and checks progress.

This is the difference between a manager who dictates every detail and one who says "the work's on the board — go."

[Explanation](./phase-3-step-3.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-3) · [Skill](../.claude/skills/phase-3-step-3-global-workspace.skill)

---

> **Checkpoint:** We now have a manager agent that breaks work into tasks, delegates to specialists who coordinate through a shared workspace, and loops until everything is done. That's a working swarm.

---

## 4. Project execution

The global workspace is a foundation. Real multi-agent systems build on it with more structure:
- **DAG-based task decomposition** - model task dependencies, blocked tasks, and tasks that can run in parallel.
- **Direct task assignment** - route tasks to specific agents based on capability.
- **Push-based task execution triggers** - start work as soon as dependencies are satisfied.
- **Parallel execution** — agents running simultaneously instead of one at a time.

That's coming in a future part.

---
**Thanks for reading! [Follow me](https://medium.com/@anzal.ansari) for the next part and more first-principles breakdowns of modern AI systems.**
