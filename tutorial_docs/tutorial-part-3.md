# Zero to Agent Swarm, Part 3: Running a Swarm

**[← Part 2: A Party of Agents](./tutorial-part-2.md)**

---

Part 2 ended with a working swarm — a manager that breaks goals into tasks, delegates to specialists via `ask_agent`, and coordinates through a shared workspace. It works. But it has a structural problem.

Everything is sequential.

The manager calls `ask_agent("coder", ...)` and blocks. When the coder finishes, the manager calls `ask_agent("writer", ...)` and blocks again. Three tasks that could run in parallel run one after the other. The bigger the project, the more this compounds.

Part 3 is about making the swarm operational: agents that run in parallel, work that expresses its own sequencing, and the foundations to observe and steer it all.

---

# Phase 1: Parallel Execution

The bottleneck is that workers are spawned inline — nested inside the manager's loop. To go parallel, workers need to be independent: separate processes that watch the workspace and claim tasks themselves.

The mental model shifts from:

```
Manager → calls worker → waits → calls next worker → waits
```

to:

```
Manager → posts all tasks → monitors

Worker 1 ─────────────────────────────────► claims task-001 → completes
Worker 2 ─────────────────────────────────────────► claims task-002 → completes
Worker 3 ─────────────────────────────────────────────────────► claims task-003 → completes
```

Three changes make this work.

---

## 1. Worker mode — the poll trigger

*Adding to the model: a new **Trigger** that watches the workspace.*

Right now, all triggers are external — a user message, a file change, a clock. We need one more: an internal trigger that fires when there's work to do.

The **poll trigger** wakes a worker on a fixed interval, checks `tasks.json` for open tasks, and if it finds one, runs the agent loop. The key behavior: if there are no open tasks, the trigger doesn't fire the loop at all. Workers sleep cheaply — no LLM calls for nothing.

```typescript
// triggers.ts
export function startPoll(onTrigger: TriggerHandler) {
  setInterval(async () => {
    if (!hasOpenTasks()) return;  // ← skip LLM call if no work
    await onTrigger("poll", "Check the workspace for an open task. Claim one and complete it.");
  }, 3000);
}
```

Any agent can become a worker by adding `"poll": true` to its genome:

```json
{
  "name": "coder",
  "triggers": { "repl": false, "poll": true }
}
```

Start it: `AGENT_NAME=coder npm start`. It will now wake every 3 seconds, check for open tasks, and work on one if found.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-1-step-1) · [Skill](../.claude/skills/part-3-phase-1-step-1-worker-mode.skill)

---

## 2. Parallel launch — one command to run the swarm

*Workers exist. Now run them all at once.*

Starting four terminal windows manually isn't a workflow. We use `concurrently` to run all processes in a single command:

```json
"swarm": "concurrently 'npm run manager' 'npm run worker:coder' 'npm run worker:researcher' 'npm run worker:writer'"
```

```
npm run swarm
```

All four processes start simultaneously. The manager has a REPL — type a goal, it decomposes into tasks, the workers pick them up.

The manager changes too. Before, it used `ask_agent` to call workers inline. Now workers are already running — the manager just posts tasks and monitors:

```
Old manager loop:
  1. Think: I need code
  2. Tool: ask_agent("coder", ...) ← blocks until done
  3. Think: I need docs
  4. Tool: ask_agent("writer", ...) ← blocks until done

New manager loop:
  1. Think: I need code and docs
  2. Tool: post_task("write calculator.py")
  3. Tool: post_task("write docs for calculator")
  4. Tool: list_tasks ← check if all done
  5. Tool: list_tasks ← check again
  6. Think: all done → summarize
```

The manager becomes a coordinator, not a dispatcher. It posts everything it knows upfront and polls for completion. Workers run whenever they're ready.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-1-step-2) · [Skill](../.claude/skills/part-3-phase-1-step-2-parallel-launch.skill)

---

## 3. Task dependencies — blocked_by

*Adding to the model: sequencing without sequential calling.*

Parallel execution has a limit: some work depends on other work. The writer can't document code that hasn't been written yet. If both tasks are `open`, the writer might claim "write docs" before the coder even starts.

The fix is a `blocked_by` field on tasks. A task with `blocked_by: ["task-001"]` won't appear as claimable until `task-001` is done. Workers skip blocked tasks naturally — they just don't see them as open.

```json
{
  "id": "task-002",
  "title": "write docs for calculator",
  "status": "open",
  "blockedBy": ["task-001"]
}
```

The manager expresses work as a **dependency graph**, not a sequence:

```
post_task("implement calculator")           → task-001
post_task("write docs", blocked_by=["task-001"])  → task-002
post_task("write tests", blocked_by=["task-001"]) → task-003
```

Tasks 002 and 003 both depend on 001, but not on each other. Once task-001 is done, both unblock simultaneously — the writer and researcher can work in parallel on documentation and tests.

The claim guard enforces it:

```typescript
if (!isUnblocked(task, tasks)) {
  return `Cannot claim ${taskId} — blocked by: ${task.blockedBy.join(", ")}`;
}
```

Workers never need to know about sequencing. They just claim whatever is open. The graph handles the ordering.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-1-step-3) · [Skill](../.claude/skills/part-3-phase-1-step-3-task-dependencies.skill)

---

> **Checkpoint:** We now have a swarm that runs in parallel. Workers are independent processes. The manager is a coordinator. Work expresses its own dependencies. Tasks that can run in parallel do.

---

## What's next

With parallel execution in place, the swarm is hard to observe. Ten agents running simultaneously, all writing to the same files — you can't tell what's happening from terminal output alone.

Phase 2 covers the operational layer:

- **Observability** — structured logs, trace IDs, a unified event stream across all agents
- **UI** — a workspace board, a log viewer, and a chat interface that lets you steer the swarm in real time
- **Modes** — autonomous, supervised (pause before irreversible actions), and manual

That's coming next.

---
**Thanks for reading! [Follow me](https://medium.com/@anzal.ansari) for the next part and more first-principles breakdowns of modern AI systems.**
