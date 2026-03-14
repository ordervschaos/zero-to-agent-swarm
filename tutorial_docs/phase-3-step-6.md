# Phase 3, Step 6 — Visualization: Seeing the Swarm

## What you'll learn

- How to build a **live dashboard** that shows task state and agent activity
- How a **standalone task board** (`npm run viz`) gives read-only visibility
- How **dry-run mode** tests the full orchestration flow without API calls
- How **summary events** deliver project results back to the user

## The Big Idea

We've built a swarm that decomposes, delegates, and executes — but you can't see it working. Agent logs scroll past, tasks complete invisibly, and there's no clear moment where the system says "here's what was done." Visibility is what separates a tool from a toy.

We add three things:
1. **A live dashboard** — integrated into the swarm's main process, shows task board + scrolling logs + input
2. **A standalone viz** — `npm run viz` in a second terminal, reads `tasks.db` directly
3. **Dry-run mode** — `DRY_RUN=1` replaces the LLM with canned responses so you can test the entire flow without API calls

## Step 1 — The summary event system

When the orchestrator's combine task finishes (the one with `reply_to: "user"`), the system should announce the result. We create a simple pub/sub:

```typescript
// src/summary.ts
export interface Summary {
  project: string;
  subtasks: { agent: string; description: string; result: string }[];
  text: string;
}

const listeners: SummaryListener[] = [];

export function onSummary(callback: SummaryListener): void {
  listeners.push(callback);
}

export function emitSummary(summary: Summary): void {
  for (const cb of listeners) cb(summary);
}
```

The `complete()` function in `task-queue.ts` checks for `reply_to === "user"` and emits:

```typescript
if (completed?.reply_to === "user") {
  // Gather sibling task results
  emitSummary({ project: projectName, subtasks, text: result });
}
```

## Step 2 — The standalone task board

`npm run viz` reads `tasks.db` and renders an ANSI-colored tree that refreshes every 500ms:

```
  TASK BOARD  3:42:15 PM
  ────────────────────────────────────

  Build a Python calculator with tests and docs
   ├ ■ DONE  coder   Implement calculator
   ├ ■ WORK  coder   Write tests            <- [3]
   ├ ■ WAIT  writer  Write documentation     <- [3]
   └ ■ WAIT  orchestrator  Combine results   <- [4,5]

  ────────────────────────────────────
  1 done | 1 working | 2 blocked
```

It uses the alternate screen buffer (`\x1B[?1049h`) and cursor hiding for a clean, flicker-free display. Since it reads the SQLite database directly, it works from a separate terminal with zero coupling to the main process.

## Step 3 — The integrated dashboard

The Ink-based dashboard replaces the basic REPL in swarm mode. It has three zones:

1. **Log stream** (top, scrolls up) — agent activity captured via `console.log` redirect
2. **Task board** (middle, live-updating) — polls `getAllTasks()` every 500ms
3. **Input line** (bottom, always visible) — supports cursor movement, Ctrl+U/A/E/W

```typescript
// Redirect console.log into the pending log buffer
console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  if (msg) pushLog(msg);
};
```

When a project completes, a `SummaryBox` appears with the orchestrator's final review and each subtask's result.

The dashboard starts **before** agents are spawned so it captures all startup logs:

```typescript
startDashboard(onInput);   // captures console.log from this point on
// ... spawn agents, start polling ...
```

## Step 4 — Dry-run mode

Set `DRY_RUN=1` and the LLM is replaced with a mock:

```typescript
const DRY_RUN = process.env.DRY_RUN === "1";
const ai = DRY_RUN ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

The mock returns canned responses:
- **Orchestrator's first call** → returns a `create_project` function call with a sensible task graph
- **Function responses** → returns acknowledgment text
- **Everything else** → returns `"[dry-run] Completed: {description}"`

This preserves the *entire* flow — claim → "LLM" → tool execution → complete → unblock → cascade — without spending a single API token.

```bash
DRY_RUN=1 SWARM_AGENTS=orchestrator,coder,writer npm run start
> Build a website with tests and docs
```

## Try it

### With the live dashboard:
```bash
SWARM_AGENTS=orchestrator,coder,writer npm run start
```

### Dry-run (no API key needed):
```bash
DRY_RUN=1 SWARM_AGENTS=orchestrator,coder,writer npm run start
```

### Standalone task board (second terminal):
```bash
npm run viz
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Summary events** | Pub/sub system that fires when `reply_to: "user"` tasks complete |
| **Dashboard** | Ink-based TUI with log stream, task board, and input |
| **Standalone viz** | Read-only task board that reads SQLite directly |
| **Dry-run mode** | Mock LLM that returns canned responses for testing |
| **Console redirect** | `console.log` captured and routed to dashboard log panel |

## The big picture

With this step, we've completed the agent swarm architecture:

| Layer | What | Analogy |
|-------|------|---------|
| Triggers | How work enters the system | Slack messages, emails |
| Task Queue | Where work is tracked | Jira board |
| Dependencies | What order things happen | Sprint planning |
| Agents | Who does the work | Team members |
| Orchestrator | Who plans the work | Project manager |
| Visualization | How you see the state | Dashboard |

The swarm is now self-organizing: give it a project, and it decomposes, delegates, executes, and combines — all without human intervention. And you can see it happen.

---

**That's the complete architecture.** From a single echo server to a self-organizing agent swarm with task dependencies, orchestration, and live visualization — all in ~1000 lines of TypeScript.
