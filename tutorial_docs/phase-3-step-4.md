# Phase 4, Step 1: DAG Execution

## What you'll learn

- How to model a project as a Directed Acyclic Graph (DAG)
- Running independent tasks in parallel with `Promise.all`
- Passing results from completed tasks as context to dependent tasks
- How a single tool call can drive a whole project to completion

## The big idea

Until now the manager posted tasks one-by-one and checked the workspace in a manual loop. That works, but it's slow — everything runs serially even when tasks have nothing to do with each other.

A **DAG** captures what actually matters: *which tasks depend on which*. Everything else can run at the same time.

```
research ──┐
           ├──▶ implement ──┬──▶ test
scaffold ──┘                └──▶ docs
```

`research` and `scaffold` share no dependency — they run in parallel. `implement` needs both — it waits. `test` and `docs` both need `implement` — they run in parallel after it.

When every node is done, the project is done. No manual loop. No checking. The structure of the graph *is* the execution plan.

## How it works

### The DAG executor (`src/dag.ts`)

A pure algorithm that knows nothing about agents or tasks — it just runs a graph:

```typescript
while (remaining nodes exist) {
  ready = nodes whose every dep is already in results
  if (ready is empty) → deadlock, throw
  results += await Promise.all(ready.map(executor))
}
```

Each "wave" finds everything that's unblocked, runs it in parallel, then checks again. This is optimal: a node runs as early as it possibly can.

### The `run_project` tool (`src/tools.ts`)

The manager calls this tool once with a goal and a list of task nodes:

```
run_project({
  goal: "Build a REST API with docs",
  tasks: [
    { id: "research",   agent: "researcher", dependsOn: [] },
    { id: "scaffold",   agent: "coder",      dependsOn: [] },
    { id: "implement",  agent: "coder",      dependsOn: ["research", "scaffold"] },
    { id: "test",       agent: "researcher", dependsOn: ["implement"] },
    { id: "docs",       agent: "writer",     dependsOn: ["implement"] }
  ]
})
```

Under the hood it:
1. Posts all tasks to the workspace (visible in the web UI)
2. Runs the DAG executor
3. For each node: claims the task, delegates to the specialist, completes it
4. Passes completed predecessors' results as context to dependent tasks
5. Returns a full summary when done

### Dependency context

When `implement` runs, its prompt automatically includes:

```
Context from completed prerequisites:
[Research findings]:
  <researcher's output>

[Project scaffold]:
  <coder's output>
```

Specialist agents don't need to re-discover anything — they inherit exactly what upstream tasks produced.

## Steps

### 1. Create the DAG executor

Create `src/dag.ts` with:
- `DagNode` type: `{ id, title, agent, dependsOn[] }`
- `DagPlan` type: `{ projectId, goal, nodes }`
- `executeDag(plan, executor)` — the wave algorithm above

### 2. Extend the workspace

In `src/workspace.ts`:
- Add `projectId?` and `dependsOn?` to the `Task` interface
- Add `postDagTask(id, title, dependsOn, projectId, postedBy)` — creates a task with a custom ID and deps
- Add `getProjectStatus(projectId)` — returns a progress summary

### 3. Add the `run_project` tool

In `src/tools.ts`:
- Import `executeDag` from `dag.ts`
- Import `postDagTask`, `getProjectStatus` from `workspace.ts`
- Add `runProjectDeclaration` — describes the `goal` + `tasks` schema to Gemini
- Add `runProject(goal, tasks)` — implements the tool (posts tasks, executes DAG, returns summary)
- Register in `toolRegistry` and `executeTool`

### 4. Update the manager

In `agents/manager/genome.json`:
- Replace `post_task` and `update_task` with `run_project` in the tools list

In `agents/manager/identity.md`:
- Teach the manager the DAG design principles: parallel = empty `dependsOn`, serial = list prerequisites
- Include a worked example

## How to try it

```bash
npm run ui
```

Make sure the agent selected is the **manager**. Give it a goal with multiple dimensions:

```
Build a Python web scraper that extracts article titles from a news site, stores them in SQLite, and includes a README
```

Watch what happens:
- The manager calls `run_project` with a DAG it designed
- The workspace populates with all tasks at once (check the web UI)
- Research and scaffolding kick off in parallel
- The scraper implementation waits, then runs with context from both
- Tests and docs run in parallel after implementation

The web UI at `http://localhost:3000` shows tasks moving from open → in_progress → done as the waves execute.

## Key concepts

| Concept | Meaning |
|---------|---------|
| Wave | A set of nodes that are all ready at the same time |
| Parallel | Nodes with no shared dependency run in the same wave |
| Serial | A node in `dependsOn` must finish before the next wave |
| Deadlock | No nodes are ready but some remain — circular dep or bad ID |
| Context passing | Prior results injected into dependent task prompts |
