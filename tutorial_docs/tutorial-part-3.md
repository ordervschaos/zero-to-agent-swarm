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

---

# Phase 2: Operating the Swarm

With parallel execution, the swarm is powerful — and invisible. Four processes writing to the same files, tasks appearing and disappearing, artifacts accumulating. You can't debug what you can't see, and you can't steer what you can't observe.

Phase 2 is the operational layer: make the swarm observable, give it a face, and let the human back in the loop.

---

## 1. Structured events — the observability backbone

*Adding to the model: a unified **event log** across all agents.*

Terminal output is for humans. When four agents run in parallel, their output interleaves into noise. You need something else: a machine-readable record of everything that happened, from every process, in order.

We add `workspace/events.jsonl` — one JSON object per line, appended by every agent in every process. Every significant thing gets logged: task lifecycle, tool calls, agent responses.

```json
{"timestamp":"...","runId":"run-1a2b3c","agentName":"coder","type":"task_claimed","data":{"taskId":"task-001","title":"implement calculator"}}
{"timestamp":"...","runId":"run-1a2b3c","agentName":"coder","type":"tool_called","data":{"tool":"bash","args":{"command":"cat calculator.py"}}}
{"timestamp":"...","runId":"run-1a2b3c","agentName":"coder","type":"task_completed","data":{"taskId":"task-001","result":"Created calculator.py"}}
```

Two things make this useful:

**`runId`** — generated once per process at startup. When all processes share the same run ID (or you filter by it), you can reconstruct the full execution of a swarm run: what the manager posted, which worker claimed each task, what tools they called, and in what order.

**Event types** — the taxonomy gives you query surfaces. Want to see only task completions? Filter on `task_completed`. Want to trace a single task from post to done? Filter on `taskId`. Want to see what the coder actually did? Filter on `agentName: coder` + `tool_called`.

The events file is append-only and written by plain `fs.appendFileSync` — no locks needed because append on a local filesystem is atomic enough for this purpose.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-2-step-1) · [Skill](../.claude/skills/part-3-phase-2-step-1-events.skill)

---

## 2. UI dashboard — see the swarm

*Adding to the model: a visual window into the workspace.*

The workspace is already the source of truth — tasks, artifacts, events are all on disk. A dashboard is just a reader: query the files, render the state, refresh when things change.

We build a minimal HTTP server in Node (`src/ui.ts`) with no framework, no build step. It serves a single HTML page that reads three endpoints:

- `/api/tasks` — the task board (open / in_progress / done)
- `/api/events` — the last 100 events
- `/api/events/stream` — a Server-Sent Events stream for live updates

```
npm run ui   →   http://localhost:3001
```

The dashboard shows three panels:
- **Task board** — tasks grouped by status, with assignee, blocked status, and result
- **Event log** — chronological feed across all agents, color-coded by event type
- **Artifacts** — everything agents have written to the shared store

Live updates work via SSE: the server watches `events.jsonl` for new appends and broadcasts them to any open browser tab. The dashboard refreshes itself — you don't need to reload.

The key insight: the UI doesn't need to talk to agents at all. The workspace is the interface. You can run the dashboard before the swarm, after it, or during — it always reflects current state.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-2-step-2) · [Skill](../.claude/skills/part-3-phase-2-step-2-ui.skill)

---

## 3. Modes — the human back in the loop

*Adding to the model: runtime behavior that responds to a **mode** setting.*

A fully autonomous swarm is great when you trust it. But sometimes you want to review what agents are about to do before they do it. That's supervised mode.

The mode lives in `workspace/settings.json`:

```json
{ "mode": "autonomous" }
```

One field. Every agent reads it on every loop iteration — not at startup, but dynamically, so you can flip the mode while the swarm is running. The UI has a toggle button that writes to the same file.

In **supervised** mode, workers change their behavior before claiming a task:
1. Write a `plan-<task-id>` artifact describing what they intend to do
2. Check for an `approved-<task-id>` artifact before proceeding
3. If no approval exists yet, release the task and stop

The approval artifact can come from anywhere — another agent, a human via the UI, a script. The worker doesn't know or care. It just checks. This is the pattern: **make the approval surface explicit in the workspace**, and any actor can fulfill it.

```
Autonomous:  worker claims → works → done
Supervised:  worker writes plan → checks for approval → works → done
                                  ↑
                         human/manager approves via artifact
```

The mode instruction is injected into the agent's system prompt at runtime, not baked into the genome:

```typescript
private buildModeInstruction(): string {
  const mode = getMode();
  if (mode === "supervised") {
    return "\n\n[MODE: supervised] Before doing any work on a task, write a brief plan...";
  }
  return "";
}
```

No code changes to deploy a different mode. No restart. The system prompt is rebuilt on every loop — flip the setting, and every agent's next iteration sees the new behavior.

[Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/part-3-phase-2-step-3) · [Skill](../.claude/skills/part-3-phase-2-step-3-modes.skill)

---

> **Checkpoint:** The swarm is now observable and steerable. Events give you a full audit trail. The dashboard gives you a live view. Modes let you dial autonomy up or down without touching code.

---

## What's next

With observable, parallel, mode-aware agents, the foundation is solid. The interesting questions shift from *how does it work* to *what can it do*:

- **Smarter task routing** — instead of any worker claiming any task, agents can self-select based on skills or the manager can assign explicitly
- **Human-in-the-loop tools** — a `request_approval` tool that pauses and waits for a real response rather than polling for an artifact
- **Persistent project context** — a project file that defines the goal, team, and constraints, injected into every agent's system prompt for long-running work
- **Cost and performance tracking** — token counts per agent per run, surfaced in the dashboard

---
**Thanks for reading! [Follow me](https://medium.com/@anzal.ansari) for the next part and more first-principles breakdowns of modern AI systems.**
