# Phase 2, Step 4: File Watcher + Clock — The Agent Wakes Itself

## What changed from Step 3

The agent no longer needs you to type to wake up. It now has **three trigger sources** — any of them can kick off the agent loop.

## What was added

1. **`handleTrigger()` function** — Unified entry point for all triggers. Accepts a source label and message, pushes it to history, and runs the agent loop. Includes a `busy` flag to prevent overlapping runs
2. **File watcher** — Uses `fs.watch()` to monitor a directory. When a file changes, the agent wakes up with a message like `[file-change] File changed: test.txt`
3. **Clock (cron-style)** — Parses a `*/N * * * *` schedule from env vars and runs `setInterval` to trigger the agent every N minutes with a configurable prompt
4. **Environment variables** — `WATCH_DIR`, `CRON_SCHEDULE`, `CRON_PROMPT` configure the new triggers
5. **Debouncing** — File watcher debounces rapid changes (500ms) to avoid triggering on every intermediate write

## The three triggers

```
1. REPL (always on)      → you type → handleTrigger("user", input)
2. File watcher (opt-in)  → file changes → handleTrigger("file-change", filename)
3. Clock (opt-in)         → timer fires → handleTrigger("clock", prompt)
         ↓                     ↓                    ↓
         └─────────────── agentLoop() ──────────────┘
```

All three feed into the same `agentLoop()`. The agent doesn't know or care what woke it up — it just sees a message in history and responds.

## Key code

```typescript
async function handleTrigger(source: string, message: string) {
  if (busy) return; // skip if already running
  busy = true;
  history.push({ role: "user", parts: [{ text: `[${source}] ${message}` }] });
  await agentLoop();
  busy = false;
}
```

## Why this matters

This transforms the agent from a chatbot into an **autonomous system**. It can:
- React to external events (files appearing, data arriving)
- Run scheduled tasks (maintenance, checks, reports)
- Still be used interactively via the REPL

All three triggers coexist — you can watch a directory, run a cron schedule, and type commands, all at the same time.

## Code organization (refactor)

This step also includes a refactor that splits the growing `index.ts` into modules:
- **`src/memory.ts`** — Memory paths and `loadMemory()`
- **`src/tools.ts`** — Tool declarations and `executeTool()`
- **`src/triggers.ts`** — REPL, file watcher, and clock setup
- **`src/index.ts`** — Agent loop and startup orchestration

## End of Phase 2

You now have a fully autonomous agent: it thinks (LLM), acts (bash), remembers (persistent memory), runs safely (Docker), and wakes itself up (triggers). Everything from here is adding more capabilities on top of this foundation.
