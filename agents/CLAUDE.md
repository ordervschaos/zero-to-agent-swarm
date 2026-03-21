# agents/ — Agent Definitions

Each agent lives in its own subdirectory: `agents/<name>/`.

## Directory Layout per Agent

```
agents/<name>/
  genome.json   — config: description, tools, triggers, maxIterations
  identity.md   — personality/system prompt (seeded from genome once, never overwritten)
  notes.md      — append-only notes saved by the agent via save_note tool
```

## genome.json Schema

```jsonc
{
  "name": "string",           // must match directory name
  "description": "string",   // shown in swarm roster; other agents use this to decide who to delegate to
  "identity": "string",      // seeds identity.md on first run; edit identity.md directly to change a live agent
  "tools": ["string"],       // subset of registered tool names from src/tools.ts
  "maxIterations": 10,       // optional, defaults to 10
  "triggers": {
    "repl": true,            // respond to stdin input
    "fileWatcher": true,     // respond to WATCH_DIR file changes
    "clock": true            // respond to CRON_SCHEDULE ticks
  }
}
```

## Current Agents

| Agent | Role | Has ask_agent | Triggers |
|-------|------|:---:|----------|
| `default` | General-purpose | yes | repl, fileWatcher, clock |
| `manager` | Orchestrator — breaks goals into tasks, delegates, never does work itself | yes | repl |
| `coder` | Writes, debugs, runs code | yes | repl |
| `researcher` | Gathers info, writes findings as artifacts | no | repl |
| `writer` | Creates docs/summaries from artifacts | no | repl |

## How Memory Works

On every turn, `identity.md` + `notes.md` are concatenated into the agent's system prompt:

```
[identity.md]

## Your notes
[notes.md]    ← only appended if non-empty
```

- `identity.md` is written **once** from `genome.json`'s `identity` field — delete it to re-seed.
- `notes.md` is **append-only** — bullets accumulate across sessions via the `save_note` tool.
- Both files are created automatically on first run if absent.

## Adding a New Agent

Create `agents/<name>/genome.json` — `identity.md` and `notes.md` are auto-created on first run.
