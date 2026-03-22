# Zero to Agent Swarm, Part 2: A Party of Agents

**[← Part 1: Birth and Upgrades](./tutorial.md)** — building a single agent from scratch.

![](images/demo.gif)

---

Here's where the mental model shifts. In the last part we've been thinking about what an agent *is* — triggers, loop, tools, memory. This part we are talking about how to make it work for us. 

We’ll start with specialization -- an agent specialized for a task with identity, tools and instructions. Then we’ll go on to build infrastructure to get multiple agents to work together.
---

## 1. Spin up multiple agents — Same code, different agent

*Adding to the model: the **Genome** that defines each agent.*

One agent is useful. But real work often needs specialists — a researcher, a coder, a reviewer — each with their own **Tools**, **Memory**, and responsibilities. A single agent can context-switch between roles, but it loses focus. Dedicated agents stay sharp — and they can work in parallel.


What makes one agent different from another? 
- Its **Thinking** (which model, what system prompt), 
- Its **Memory** (what it knows)
- Its **Tools** (what it can do)
- Its **Triggers** (what wakes it up)
- Its **Container** (what it can see). 
Package one or more of these together into a config — the agent's genome — and from one codebase you can spin up as many specialized agents as you need.

That’s what we are doing in this step:
[Explanation](./phase-3-step-1.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-1) · [Skill](../.claude/skills/phase-3-step-1-agent-replication.skill)

---

## 2. Agent to agent delegation — The simplest possible multi-agent pattern
Now we have *multiple* agents. We don’t have a *team* of agents.  For that there needs to be cohesion and direction. Agents need to be able to rely on each other. First step towards that is asking for help when needed.

Currently, each agent is in a silo of itself -- if the **coder** needs documentation, it has to write it itself. What if there’s a **writer** agent can do it better and cheaper? Delegation is the natural next step.


The simplest way to achieve this is by allowing an agent to call another agent as a tool.


```
User → Researcher: "Get the weather in Toronto and have someone write a summary"
         ├── weather: checks Toronto weather
         ├── ask_agent("writer", "summarize the weather in Toronto")
         │     └── Writer runs → returns summary
         └── delivers: "Toronto weather summary"
         
User → God: "Oh God, why?!!"
```


The implementation is straightforward, we add a new tool `ask_agent`. Now one agent loops inside another agent’s loop — the same pattern from Phase 1, just nested:

[Explanation](./phase-3-step-2.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-2-new) · [Skill](../.claude/skills/phase-3-step-2-delegation.skill)


---

## 3. Workspace — Shared state for agent coordination

*Adding to the model: a **Global Workspace** where agents coordinate through shared tasks and artifacts.*

Delegation is powerful, but it has a bottleneck: all information flows through the delegator. When the researcher checks the weather in two cities, the results come back as a return value — and the researcher has to relay them to the writer(It’s not her job). The researcher becomes a middleman, passing data it doesn't need to understand. 

A **global workspace** solves this. We’ll also appoint a **manager** agent who acts as the bridge between the user and specialist agents. It's a shared directory on disk with two coordination primitives:

- **Tasks** — a shared to-do list. The manager posts tasks, delegates to specialists who claim them, check progress, and keeps going until everything is done.
- **Artifacts** — a key-value store for data. Research findings, drafts, analysis — anything one agent produces that another might need.

### The manager loop

A **manager agent** drives the whole thing. Its identity is simple: break the goal into tasks, delegate each to a specialist, check progress, repeat until done. The manager never does the work itself — it orchestrates.

![](images/20260321124225.png)

Without the workspace, the manager has to micromanage everything — relaying data between agents like a middleman. With the workspace, agents self-serve: the manager says "check the workspace for open tasks" and each specialist claims work, reads artifacts for context, does the job, and marks it done. The manager doesn't relay data — it just points agents at the workspace and checks progress.

This is the difference between a manager who dictates every detail and one who says "the work's on the board — go."

[Explanation](./phase-3-step-3.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-3) · [Skill](../.claude/skills/phase-3-step-3-global-workspace.skill)

---

> **Checkpoint:** We now have a manager agent that breaks work into tasks, delegates to specialists who coordinate through a shared workspace, and loops until everything is done. That's a working swarm.

## 3.5 A fun intermission - Let's build a web UI

The swarm is starting to do real work. But watching it means reading JSON files and terminal output. A web dashboard gives you a live window into everything at once — tasks moving through a kanban, agents chatting, artifacts appearing, log events streaming in.

![](images/20260321130625.png)

The key idea is an **event bus** (`log-events.ts`): a Node.js `EventEmitter` that agents write to as they work. The UI server holds a set of open browser connections and forwards every event to every tab via **Server-Sent Events** (SSE). The browser never polls — it just listens.

```
Agent loop
  │  emits on logBus
  ▼
ui-server.ts
  │  broadcasts via SSE
  ▼
browser (EventSource) → Kanban · Artifacts · Chat · Logs
```

Two new files do all the work:

- **`src/ui-server.ts`** — a plain Node.js HTTP server. Serves `ui/index.html`, exposes a REST API (`/api/agents`, `/api/tasks`, `/api/artifacts`, `/api/chat`, `/api/clear`), and streams live events via SSE at `/api/events`. Keeps one `Agent` instance per agent name so chat history persists across messages.
- **`ui/index.html`** — a single HTML file (no bundler, no framework). A 2×2 CSS grid: Tasks kanban top-left, Artifacts top-right, Chat bottom-left, Logs bottom-right. All panels update live from the SSE stream.

```bash
npm run ui   # http://localhost:3000
```

[Explanation](./phase-3-step-3-5.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-3-5) · [Skill](../.claude/skills/phase-3-step-3-5-web-ui.skill)

---

## 4. DAG Execution — From flat task lists to structured project plans

*Adding to the model: a **Task Tree** that captures dependencies, enabling parallel + serial execution.*

The global workspace is a foundation — but it's flat. The manager posts tasks one-by-one, checks progress in a loop, and everything runs serially even when tasks have nothing to do with each other. Real projects have structure: some things must happen in order, others can happen at the same time.
![](images/20260321154731.png)


![](images/20260321154559.png)

A **DAG** (Directed Acyclic Graph) captures what actually matters: *which tasks depend on which*. Everything else can run simultaneously.

```
Check weather in Toronto ──┐
                           ├──▶ Compare and summarize both cities weather
Check weather in London  ──┘
```

`Check weather in Toronto` and `Check weather in London` share no dependency — they run in parallel. `Compare and summarize` needs both — it waits until both are done.

### The tree model

Rather than making the LLM specify flat `dependsOn` arrays (error-prone), the manager thinks in **task trees** — a structure that maps naturally to how we decompose work:

```json
{
  "goal": "Compare the weather in Toronto and London",
  "sequential": true,
  "tasks": [
    { "id": "gather", "title": "Gather weather data", "agent": "researcher",
      "sequential": false, "subtasks": [
        { "id": "toronto", "title": "Check weather in Toronto", "agent": "researcher" },
        { "id": "london", "title": "Check weather in London", "agent": "researcher" }
      ]},
    { "id": "compare", "title": "Compare and summarize both cities weather", "agent": "writer" }
  ]
}
```

Two rules control the tree:
- **`sequential: true`** — siblings run one after another, each blocked by the previous
- **`sequential: false`** (or omitted) — siblings run in parallel

Container tasks (those with `subtasks`) auto-complete when all their children finish. Only leaf tasks get delegated to specialist agents.

The runtime flattens this tree into a DAG with computed `dependsOn` arrays, then executes it in waves:

```typescript
while (remaining nodes exist) {
  ready = nodes whose every dep is already in results
  if (ready is empty) → deadlock, throw
  results += await Promise.all(ready.map(executor))
}
```

Each wave finds everything that's unblocked, runs it in parallel with `Promise.all`, then checks again. A node runs as early as it possibly can.

### Context passing

When a dependent task runs, it automatically receives the results from its prerequisites:

```
Context from completed prerequisites:
[Check weather in Toronto]:
  Toronto: 2°C, overcast, feels like -1°C, humidity 80%

[Check weather in London]:
  London: 7°C, sunny, feels like 6°C, humidity 81%
```

The writer doesn't need to look up the weather itself — it inherits exactly what the researcher produced upstream.

### The `run_project` tool

The manager calls this once with a goal and a task tree. Under the hood it:
1. Flattens the tree into a DAG with computed dependencies
2. Posts all tasks to the workspace (visible in the web UI immediately)
3. Executes the DAG wave by wave
4. For each leaf: claims the task, delegates to the specialist, completes it
5. Returns a full summary when the entire graph is done

### DAG visualization in the web UI

The dashboard gained two new views — toggle between Kanban, DAG, and Timeline. The DAG view shows the task tree as a nested list with sequential (numbered) and parallel (purple-highlighted) groupings. The Timeline view shows a Chrome DevTools-style waterfall where parallel tasks visually overlap on the same time axis — making concurrency immediately obvious. Tasks light up as they progress: grey (open), yellow (in progress), green with strikethrough (done).

### Why trees over flat lists

The manager's decision rule is simple: *"Does task B need the output of task A?"* If no, they're parallel. If yes, they're sequential. Checking weather in Toronto doesn't depend on checking weather in London — parallel. Writing the comparison needs both results — sequential after the parallel group. Nesting captures this naturally — no need to manually wire dependency IDs.

This is the difference between a project plan that says "check Toronto, then check London, then compare" (serial — slow) and one that says "check both cities at the same time, then compare" (parallel where possible — fast). The DAG finds the fastest path through the work.

[Explanation](./phase-4-step-1.md) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-4-step-1) · [Skill](../.claude/skills/phase-4-step-1-dag-execution.skill)

---

> **Checkpoint:** We now have a manager agent that decomposes goals into structured task trees, executes them as DAGs with maximum parallelism, passes context between dependent tasks, and visualizes the whole thing in a live web dashboard. That's a production-grade orchestration pattern.

## What's next

With DAG execution in place, the swarm can tackle projects with real structure — not just a flat list of chores, but a plan where each piece builds on the last. Next up: **reactive tasks** — tasks that spawn new sub-DAGs based on what they discover at runtime.

---
**Thanks for reading! [Follow me](https://medium.com/@anzal.ansari) for the next part and more first-principles breakdowns of modern AI systems.**
