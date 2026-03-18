# Phase 3, Step 3 — Global Workspace: Shared State for Agent Coordination

## What you'll learn

- How a **global workspace** gives agents a shared space to coordinate
- How a **manager agent** drives a multi-agent workflow to completion
- How **tasks** and **artifacts** let agents divide work and share data
- How `maxIterations` in the genome controls an agent's loop budget

## The Big Idea

In step 2, delegation worked like a function call: the coder delegates to the writer, gets a result back. Clean — but all data flows through whoever delegates. The coder is a bottleneck. And there's no persistent view of what's been done, what's in progress, or what's next.

A **global workspace** solves both problems. It's a shared directory on disk with two coordination primitives:

1. **Tasks** — a shared to-do list. The manager posts tasks, delegates to specialists who claim and complete them, then checks progress and keeps going.
2. **Artifacts** — a key-value store. Data that one agent produces and another consumes — without the delegator relaying it.

A **manager agent** ties it together. It breaks the goal into tasks, delegates to the right specialists, checks the task list after each delegation, and loops until everything is done.

## Step 1 — The workspace module: `src/workspace.ts`

The workspace is a directory with two JSON files:

```
workspace/
├── tasks.json       ← shared task list
└── artifacts.json   ← shared data store
```

### Tasks

A task has a simple lifecycle: `open` → `in_progress` → `done`.

```typescript
export interface Task {
  id: string;           // "task-001"
  title: string;        // what needs doing
  status: "open" | "in_progress" | "done";
  assignee: string;     // who claimed it
  postedBy: string;     // who created it
  result: string;       // what happened
}
```

Three operations:

```typescript
export function postTask(title: string, postedBy: string): string {
  // Creates a new open task with an auto-incrementing ID
  const id = `task-${String(tasks.length + 1).padStart(3, "0")}`;
  const task: Task = { id, title, status: "open", assignee: "", postedBy, result: "" };
  // ...
}

export function listTasks(status?: string): string {
  // Lists all tasks, or filters by status
}

export function updateTask(taskId: string, agent: string, action: "claim" | "complete", result?: string): string {
  // claim: sets status to in_progress, assigns to agent
  // complete: sets status to done, records result
}
```

The key design choice: **claiming**. An agent doesn't just start working — it claims the task first, which sets `assignee` and moves status to `in_progress`. Other agents can see what's taken and what's still available.

### Artifacts

Artifacts are a key-value store for sharing data between agents:

```typescript
export interface Artifact {
  key: string;
  value: string;
  author: string;
  timestamp: string;
}
```

Writing to an existing key upserts — latest value wins. This keeps it simple: agents always see the current state.

## Step 2 — Five new tools

| Tool | What it does |
|------|-------------|
| `post_task` | Add a task to the workspace |
| `list_tasks` | See tasks, optionally filter by status |
| `update_task` | Claim an open task or complete one with a result |
| `write_artifact` | Store data under a key |
| `read_artifact` | Read one key, or list all artifacts |

The `update_task` tool tags the claiming agent automatically — agents can only claim as themselves:

```typescript
case "update_task":
  return updateTask(args.task_id, activeAgent, args.action, args.result);
```

And `write_artifact` tags the author:

```typescript
case "write_artifact":
  return writeArtifact(args.key, args.value, activeAgent);
```

## Step 3 — The manager agent

The manager is just an agent with the right genome — no special code:

```json
{
  "name": "manager",
  "description": "Orchestrator that breaks work into tasks and delegates until done",
  "identity": "You are a manager agent. When given a goal:\n1. Break it into tasks using post_task\n2. For each task, delegate to the best specialist using ask_agent\n3. After each delegation, check list_tasks to see what's still open\n4. Keep delegating until all tasks are done\n5. Summarize the results and respond\n\nNever do the work yourself — always delegate to specialists.",
  "tools": ["ask_agent", "post_task", "list_tasks", "update_task", "read_artifact", "write_artifact"],
  "maxIterations": 25
}
```

Two things to notice:

**The identity is a protocol.** It tells the manager exactly what to do on every cycle: post tasks, delegate, check progress, repeat. Without this, the manager would just respond to the user like a chatbot.

**`maxIterations: 25`.** The default is 10 — plenty for a specialist doing one piece of work. But a manager posting 3 tasks, delegating 3 times, and checking between each needs more room. The genome now supports `maxIterations` as an optional field:

```typescript
// config.ts
export interface AgentConfig {
  // ...
  maxIterations?: number;
}

// agent.ts
const maxIter = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
for (let i = 0; i < maxIter; i++) {
```

## Step 4 — Agent identities guide the workflow

Specialists need to know to use the workspace. Their identities say so:

**Coder:**
> "Check the global workspace for tasks you can pick up and artifacts left by other agents. When you finish work, write results as artifacts so others can use them."

**Researcher:**
> "Check the global workspace for tasks you can pick up. Always write your findings as artifacts on the workspace so other agents can use them."

**Writer:**
> "Check the global workspace for tasks and read artifacts left by other agents before writing."

When the manager delegates with "check the workspace for open tasks", each specialist knows what that means: `list_tasks("open")`, claim one, do the work, write artifacts, complete the task.

## Try it

```bash
AGENT_NAME=manager npm start
```

Then:

```
you: Build a calculator with tests and docs
```

Watch the manager loop:

1. `post_task("implement calculator")`, `post_task("write tests")`, `post_task("write docs")`
2. `ask_agent("coder", "Check the workspace for open tasks and pick up the coding work")`
   - Coder: `list_tasks("open")` → claims task-001 → writes `calculator.py` → completes task → writes artifact `calculator-api`
3. `list_tasks` → 1 done, 2 open
4. `ask_agent("researcher", "Check the workspace for open tasks")`
   - Researcher: claims task-002 → reads `calculator-api` artifact → writes tests → completes task → writes artifact `test-results`
5. `list_tasks` → 2 done, 1 open
6. `ask_agent("writer", "Check the workspace for open tasks")`
   - Writer: claims task-003 → reads artifacts → writes docs → completes task
7. `list_tasks` → all done
8. Manager responds: "All tasks complete. Calculator built with tests and docs."

The manager's loop drives the work forward. Each specialist self-serves from the workspace — claims a task, reads artifacts for context, does the work, writes results back. The manager doesn't relay data; it just orchestrates who works when.

## What's on disk after a run

```
workspace/
├── tasks.json
└── artifacts.json
```

**tasks.json:**
```json
[
  {
    "id": "task-001",
    "title": "implement calculator",
    "status": "done",
    "assignee": "coder",
    "postedBy": "manager",
    "result": "Created calculator.py with add, subtract, multiply, divide"
  },
  {
    "id": "task-002",
    "title": "write tests for calculator",
    "status": "done",
    "assignee": "researcher",
    "postedBy": "manager",
    "result": "Created test_calculator.py — all 8 tests pass"
  },
  {
    "id": "task-003",
    "title": "write documentation",
    "status": "done",
    "assignee": "writer",
    "postedBy": "manager",
    "result": "Created calculator_docs.md"
  }
]
```

**artifacts.json:**
```json
[
  {
    "key": "calculator-api",
    "value": "Functions: add(a, b), subtract(a, b), multiply(a, b), divide(a, b)...",
    "author": "coder",
    "timestamp": "2025-03-18T10:30:00.000Z"
  },
  {
    "key": "test-results",
    "value": "8 tests, 8 passed. Coverage: 100%...",
    "author": "researcher",
    "timestamp": "2025-03-18T10:31:00.000Z"
  }
]
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Global workspace** | A shared directory with tasks + artifacts — the coordination layer |
| **Manager as driver** | Posts tasks, delegates, checks progress, loops until done |
| **Task lifecycle** | open → in_progress → done. Claiming prevents double work |
| **Artifacts as shared data** | Agents write findings; other agents read them. No middleman |
| **maxIterations in genome** | Managers need more loop budget than specialists |
| **Delegation + workspace** | Delegation orchestrates *who works*; the workspace coordinates *what they know* |

## Design considerations

**Why separate tasks from artifacts?** They serve different purposes. Tasks are about *what needs doing* — they have status, ownership, lifecycle. Artifacts are about *what's been learned* — they're reference data with no lifecycle. You could put everything in one store, but separating them makes each concept clearer.

**Why a manager instead of letting agents self-organize?** Without a driver, agents complete one task and stop. Nobody looks at the board and says "what's next?" The manager's identity explicitly tells it to keep checking and keep delegating — that's what turns a collection of capable agents into a team that finishes things.

**Why `maxIterations` in the genome?** A specialist doing one task needs 5-8 iterations. A manager orchestrating 3+ tasks needs 15-20. Making it configurable per agent keeps specialists fast (they hit the safety cap sooner if they loop) while giving managers room to work.

**Why upsert for artifacts?** Simplicity. If the researcher runs analysis twice, you want the latest — not two conflicting versions. For coordination, latest-wins is usually right.

## What's missing (and what's next)

- No permissions — any agent can do anything in the workspace
- No project scoping — the workspace is global, not tied to a specific goal
- No parallel execution — the manager delegates sequentially, one agent at a time
- No notifications — the manager polls `list_tasks` to check progress

These gaps point toward **project mode**: scoped workspaces, role-based permissions, a shared goal injected into system prompts, and eventually parallel agent execution.
