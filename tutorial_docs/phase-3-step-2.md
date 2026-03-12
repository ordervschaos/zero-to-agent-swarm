# Phase 3, Step 2 — Task Queue & Task Manager

## What you'll learn

- How to build a **shared task queue** that multiple agents pull from
- How to use an **LLM as a task manager** that decomposes user requests into subtasks
- How watchers (REPL, file watcher) feed into a **routing layer** instead of directly into agents
- How agents **poll** for work instead of being triggered directly

## The Big Idea

Until now, each trigger (REPL input, file change) went straight to a single agent. That works for one agent, but in a swarm you need **coordination**. The pattern:

```
User input → Task Manager (LLM) → Task Queue → Agents poll for work
```

The Task Manager is itself an LLM call — but a specialized one. It doesn't _do_ the work, it decides _who_ should do _what_. This is a common multi-agent pattern called **orchestrator-worker**.

## Step 1 — The Task Queue

The queue is dead simple: an array of task objects with a status field.

```typescript
// src/task-queue.ts
export interface Task {
  id: string;
  description: string;
  assignedTo: string;  // which agent should do this
  status: "pending" | "in-progress" | "done" | "failed";
  result?: string;
}
```

Key operations:
- **`enqueue(description, assignedTo)`** — task manager pushes tasks here
- **`claim(agentName)`** — agent pulls the next pending task assigned to it
- **`complete(taskId, result)`** — agent marks work as done

Why not a database? We'll get there. For now, an in-memory array is the simplest thing that works. The important concept is the **interface**, not the storage.

## Step 2 — The Task Manager

The task manager receives raw input and uses the LLM to split it:

```typescript
// src/task-manager.ts
const systemInstruction = `You are a task manager.
Split user requests into subtasks and assign each to an agent.
Available agents:
- "coder": writes code, runs scripts
- "writer": creates docs and text content
Respond ONLY with JSON: [{"agent":"coder","task":"..."},{"agent":"writer","task":"..."}]`;
```

The LLM sees the available agents and their descriptions, then returns a JSON array of subtasks. Each subtask gets `enqueue()`'d.

**Fallback**: if the LLM returns garbage instead of JSON, we just assign the whole input to the first agent. Always have a fallback.

## Step 3 — Agents Poll the Queue

Each agent runs a `setInterval` that checks the queue every second:

```typescript
startPolling(): void {
  setInterval(async () => {
    if (this.busy) return;
    const task = claim(this.config.name);
    if (!task) return;

    this.busy = true;
    // Process through the normal agentic loop...
    await this.loop();
    complete(task.id, "finished");
    this.busy = false;
  }, 1_000);
}
```

This is a **pull model** — agents pull work when they're ready, rather than having work pushed onto them. Benefits:
- Natural backpressure (busy agents don't get overloaded)
- Easy to scale (add more agents of the same type)
- Decoupled (queue doesn't need to know about agent internals)

## Step 4 — Wiring It Together

The entry point now has two modes:

```bash
# Swarm mode — multiple agents, task manager routing
SWARM_AGENTS=coder,writer npm run start

# Solo mode — original single-agent behavior
npm run start
```

In swarm mode:
1. All agent configs are loaded and agents are spawned
2. Triggers (REPL, file watcher) feed into the task manager
3. Task manager splits input and enqueues subtasks
4. Each agent polls the queue for work assigned to it

## Try it

```bash
SWARM_AGENTS=coder,writer npm run start
```

Then type something like:
```
you: Create a hello.py script and write a README explaining how to use it
```

Watch the task manager split this into two subtasks — one for the coder (write the script) and one for the writer (write the README). Each agent picks up its task independently.

## What's really happening

```
you: "Create a hello.py script and write a README"
  ↓
[task-manager] LLM splits into:
  task-1 → coder: "Create a hello.py script"
  task-2 → writer: "Write a README explaining how to use hello.py"
  ↓
[coder] picks up task-1, uses bash tool to write hello.py
[writer] picks up task-2, uses bash tool to write README.md
  ↓
Both tasks complete independently
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Task Queue** | Shared data structure agents pull from |
| **Task Manager** | LLM that decomposes requests, doesn't execute them |
| **Pull model** | Agents claim work when ready (vs push) |
| **Orchestrator-worker** | One LLM routes, others execute |
| **Backpressure** | Busy agents naturally skip polling |

## What's missing (and what's next)

- The queue is in-memory — dies when the process stops. Next step: **SQLite blackboard**.
- Agents can't see each other's results. Next step: **shared state**.
- No dependency ordering between tasks. Next step: **task DAGs**.
- The task manager is fire-and-forget. Next step: **status tracking and retries**.

---

**Next**: [Phase 3, Step 3 — Message Bus](phase-3-step-3.md) — agents talking to each other.
