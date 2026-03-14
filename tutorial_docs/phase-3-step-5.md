# Phase 3, Step 5 — The Orchestrator: A Planning Agent

## What you'll learn

- How a **dedicated orchestrator** decomposes projects into structured task graphs
- How `create_project` creates an **entire dependency DAG** in one atomic call
- How **cycle detection** prevents impossible task graphs
- How **terminal tools** let an agent delegate and yield without continuing
- How **reply_to** routes completed results back to the user

## The Big Idea

In the last step we built the dependency engine — tasks can wait for other tasks. But who creates those dependency graphs? Right now, a human would have to call `enqueueWithDeps` manually. What we want is an agent that does the planning: you say "build a calculator with tests and docs," and it figures out the task graph.

Enter the orchestrator — a project manager agent. It doesn't write code or docs. It decomposes, delegates, and combines. Think of the division of labor in a real team:

```
User: "Build a calculator with tests and docs"
  → Orchestrator decomposes into task graph
    → Coder implements (no dependencies)
    → Coder writes tests (depends on implementation)
    → Writer writes docs (depends on implementation)
    → Orchestrator combines results (depends on everything)
  → User gets final report
```

## Step 1 — The `create_project` tool

Instead of calling `assign_task` repeatedly, the orchestrator uses a dedicated planning tool that takes the whole graph at once:

```typescript
{
  "project": "Build a calculator with tests and docs",
  "tasks": [
    { "id": "t1", "description": "Implement calculator", "agent": "coder", "depends_on": [] },
    { "id": "t2", "description": "Write tests", "agent": "coder", "depends_on": ["t1"] },
    { "id": "t3", "description": "Write documentation", "agent": "writer", "depends_on": ["t1"] }
  ]
}
```

The tool does a lot of work behind the scenes:

1. **Validates** that all target agents exist
2. **Detects cycles** via topological sort — if the graph has a circular dependency, it rejects it
3. **Creates a parent task** (the project container)
4. **Two-pass enqueue** — first tasks with no deps (start as `pending`), then tasks with deps (start as `blocked`), translating local reference IDs ("t1") to real database IDs
5. **Auto-creates a combine task** — a final task for the orchestrator that depends on everything, with `reply_to: "user"` so results flow back

```typescript
// Cycle detection via topological sort
const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
let sorted = 0;
while (queue.length > 0) {
  const node = queue.shift()!;
  sorted++;
  for (const neighbor of graph[node] ?? []) {
    inDegree[neighbor]--;
    if (inDegree[neighbor] === 0) queue.push(neighbor);
  }
}
if (sorted !== tasks.length) {
  return "Circular dependency detected in task graph.";
}
```

### Why a dedicated tool instead of multiple `assign_task` calls?

- **Atomic** — the whole graph is created or none of it is
- **Validated** — cycles are caught before any tasks exist
- **Structured** — dependencies are explicit, not buried in task descriptions
- **Self-completing** — the combine task is auto-created

## Step 2 — The orchestrator genome

```json
{
  "name": "orchestrator",
  "description": "Project manager — decomposes projects into task graphs and delegates to specialists",
  "tools": ["create_project", "show_tasks", "save_note"]
}
```

Notice what's **missing**: no `bash`, no `assign_task`. The orchestrator plans — it doesn't execute. This is deliberate. A project manager who also writes code is a project manager who doesn't manage. The tools define the role.

## Step 3 — Terminal tools

When the orchestrator calls `create_project`, it's done — the work has been delegated. It shouldn't keep looping. We add a concept of **terminal tools**: after calling `create_project` or `assign_task`, the agent's loop exits immediately.

```typescript
// Terminal tools — delegation is done, exit the loop
if (call.name === "create_project" || call.name === "assign_task") {
  console.log(`  [${this.config.name}] delegation complete, yielding`);
  return result;
}
```

This prevents the orchestrator from wasting iterations after it's already planned the project.

## Step 4 — Smart routing

When the orchestrator is in the swarm, unaddressed input goes to it by default — it's the front door:

```typescript
const defaultTarget = agentNames.includes("orchestrator")
  ? "orchestrator"
  : agentNames[0];
```

You can still address specific agents with `coder: do something`, but plain messages go to the orchestrator for decomposition.

## Step 5 — Active agent registry

Previously, the roster showed all agents on disk. Now we register only the agents that are actually running:

```typescript
export function setActiveAgents(names: string[]): void {
  activeAgents = [...names];
}
```

This prevents the orchestrator from assigning tasks to agents that aren't polling.

## Step 6 — The `reply_to` field

We add a `reply_to` field to tasks. When the auto-generated combine task finishes (the orchestrator's final review), the system knows the result should be delivered to the user. This is the plumbing for results to flow back — visualization (next step) will use it.

## Try it

```bash
SWARM_AGENTS=orchestrator,coder,writer npm run dev
```

Give it a project:

```
you: Build a Python calculator with tests and docs
```

Watch the orchestrator decompose it:

```
[orchestrator] picked up task-1: "Build a Python calculator with tests and docs"
[orchestrator] [tool: create_project({project: "Build a Python calculator...", tasks: [...]})]
  [queue] added task-2 → orchestrator: "Build a Python calculator..."
  [queue] task-2 done.
  [queue] added task-3 → coder: "Implement calculator"
  [queue] added task-4 → coder: "Write tests" (blocked by [3])
  [queue] added task-5 → writer: "Write documentation" (blocked by [3])
  [queue] added task-6 → orchestrator: "Combine results" (blocked by [3, 4, 5])
[orchestrator] delegation complete, yielding
[coder] picked up task-3: "Implement calculator"
  ...
  [queue] task-3 done.
  [queue] task-4 unblocked → pending
  [queue] task-5 unblocked → pending
[coder] picked up task-4: "Write tests"
[writer] picked up task-5: "Write documentation"
  ...
  [queue] task-4 done.
  [queue] task-5 done.
  [queue] task-6 unblocked → pending
[orchestrator] picked up task-6: "Combine results"
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Orchestrator** | A planning agent that decomposes but doesn't execute |
| **create_project** | Atomic tool that builds an entire dependency DAG |
| **Cycle detection** | Topological sort rejects circular dependencies |
| **Terminal tools** | Agent yields immediately after delegation |
| **reply_to** | Marks which tasks should deliver results to the user |
| **Active registry** | Only running agents appear in rosters and are valid targets |

## What's missing (and what's next)

- No way to **see** the task graph while it's running — next: **live visualization**
- No way to **test** the full flow without API calls — next: **dry-run mode**
- Results flow through the graph but aren't displayed prominently — next: **summary dashboard**

---

**Next**: Phase 3, Step 6 — Visualization: a live dashboard, standalone task board, and dry-run mode.
