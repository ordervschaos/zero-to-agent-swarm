# Phase 3, Step 4 — Task Dependencies: Work That Waits

## What you'll learn

- How to add **dependencies** between tasks so B waits for A to finish
- How a **blocked** status creates ordered execution without a scheduler
- How the **unblocking cascade** resolves a dependency graph automatically
- How **dependency context injection** gives downstream tasks the results they need

## The Big Idea

Right now, agents can delegate tasks to each other — but there's no ordering. If the coder delegates "write docs" to the writer at the same time it's still coding, the writer starts immediately with no code to document. There's no way to say "do A first, then B."

We need dependencies: task B shouldn't start until task A finishes.

```
Before:  coder creates task → writer picks it up immediately (maybe too early)
After:   coder creates task → task starts "blocked" → unblocks when prerequisites finish
```

The key insight: we don't need a scheduler. We just need tasks that know what they're waiting for, and a cascade that fires when anything finishes.

## Step 1 — New fields on every task

We add two fields to the task schema:

```typescript
parent_id: number | null    // groups subtasks under a project
depends_on: number[]        // task IDs that must complete first
```

And a new status: `"blocked"`. A blocked task sits in the queue but no agent can claim it. Only `pending` tasks get claimed.

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT    NOT NULL,
    assigned_to TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    result      TEXT,
    parent_id   INTEGER,
    depends_on  TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
)
```

`depends_on` is stored as a JSON array of task IDs. SQLite doesn't have array types, but JSON strings work fine — we parse them on read.

## Step 2 — Creating tasks with dependencies

The new `enqueueWithDeps` function replaces the simple `enqueue` for tasks that need ordering:

```typescript
export function enqueueWithDeps(
  description: string,
  assignedTo: string,
  opts: { parentId?: number; dependsOn?: number[] } = {}
): Task {
  const deps = opts.dependsOn ?? [];
  const status = deps.length > 0 ? "blocked" : "pending";
  // ... insert with status and deps
}
```

If a task has dependencies, it starts as `blocked`. No dependencies? It starts as `pending` and an agent can pick it up immediately. The original `enqueue` still works — it just calls `enqueueWithDeps` with no options.

## Step 3 — The unblocking cascade

This is where the magic happens. When any task completes, we scan all blocked tasks and check if their dependencies are now met:

```typescript
export function complete(taskId: number, result: string): void {
  completeStmt.run(result, taskId);

  // Unblock tasks whose dependencies are now all met
  const blocked = getBlockedStmt.all();
  for (const row of blocked) {
    const deps = JSON.parse(row.depends_on);
    const allDone = deps.every(depId => {
      const dep = getTask(depId);
      return dep?.status === "done";
    });
    if (allDone) {
      unblockStmt.run(row.id);  // blocked → pending
    }
  }
}
```

This creates a cascade. Finishing task A might unblock B and C. When B and C both finish, that unblocks D. The dependency graph resolves itself — no scheduler, no coordinator, no polling. Just a simple check that runs after every completion.

```
Task A finishes
  → scans blocked tasks
  → Task B depends on [A] → A is done → unblock B
  → Task C depends on [A] → A is done → unblock C
  → Task D depends on [B, C] → B pending, C pending → stays blocked

Task B finishes
  → Task D depends on [B, C] → B done, C pending → stays blocked

Task C finishes
  → Task D depends on [B, C] → B done, C done → unblock D!
```

## Step 4 — Capturing real results

Previously, every completed task got the result `"finished"`. That's useless for downstream tasks. Now `loop()` returns the agent's actual output:

```typescript
private async loop(): Promise<string> {
  // ... agent loop ...
  // When the LLM produces text (no tool call), that's the result
  const text = response.text ?? "";
  return text;
}
```

And the polling code captures it:

```typescript
const result = await this.loop();
complete(task.id, result || "finished");
```

## Step 5 — Dependency context injection

When an agent picks up a task that had dependencies, it needs to know what those prerequisite tasks produced. We inject the results directly into the task prompt:

```typescript
let taskMessage = `[task] ${task.description}`;
if (task.depends_on.length > 0) {
  const depResults = getDependencyResults(task.id);
  for (const [depId, result] of Object.entries(depResults)) {
    taskMessage += `\n  - task-${depId}: ${result}`;
  }
}
```

So a "write tests" task that depends on "write code" sees:

```
[task] Write tests for the implementation

Prerequisite results:
  - task-3: Created calculator.py with add, subtract, multiply, divide functions
```

The agent has the context it needs without having to go looking for it.

## Try it

Dependencies are infrastructure — they don't change the user experience yet. You can test them programmatically by calling `enqueueWithDeps` directly, or wait for the next step where we build a tool that creates entire dependency graphs.

To verify the schema change, just start the swarm and check the logs:

```bash
SWARM_AGENTS=coder,writer npm run dev
```

Tasks created via `assign_task` still work exactly as before — they just have `depends_on: []` and `parent_id: null`.

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Task dependencies** | A task can declare which other tasks must finish first |
| **Blocked status** | Tasks with unmet dependencies can't be claimed by agents |
| **Unblocking cascade** | Completing a task automatically unblocks anything waiting on it |
| **Dependency context** | Downstream tasks receive upstream results in their prompt |
| **Result capture** | Agent output is stored as the task result, not just "finished" |

## What's missing (and what's next)

- We can create tasks with dependencies, but there's no high-level tool to plan a whole project — next: **orchestrator agent** with a `create_project` tool
- No validation for circular dependencies — next: **cycle detection** before tasks are created
- No way to see the state of the dependency graph — next: **visualization**

---

**Next**: Phase 3, Step 5 — The Orchestrator: a planning agent that decomposes projects into dependency graphs.
