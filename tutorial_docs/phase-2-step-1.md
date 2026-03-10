# Phase 2, Step 1: Persistent Memory Across Sessions

## What changed from Phase 1

The agent now **remembers things** between restarts. Previously, all context was lost when you stopped the process. Now it has two types of persistent memory.

## What was added

1. **`memory/` directory** — Created on first run, persists on disk
2. **`memory/identity.md`** — Human-curated identity file. You edit this to tell the agent who it is, what it should do, what its rules are. Loaded into the system prompt every turn
3. **`memory/notes.md`** — Agent-curated notes file. The agent writes to this using a new `save_note` tool. Also loaded into the system prompt
4. **`loadMemory()` function** — Reads both files and combines them into the system instruction
5. **`save_note` tool** — New tool that appends a line to `notes.md`

## How memory works

```
System prompt = identity.md + notes.md
                (you write)    (agent writes)
```

On every LLM call, `loadMemory()` reads both files fresh. This means:
- If you edit `identity.md` while the agent runs, it picks up changes next turn
- When the agent saves a note, it's available immediately on the next turn
- Both files survive restarts

## Key code

```typescript
function loadMemory(): string {
  const identity = fs.readFileSync(IDENTITY_PATH, "utf-8").trim();
  const notes = fs.readFileSync(NOTES_PATH, "utf-8").trim();
  let system = identity;
  if (notes) system += `\n\n## Your notes\n${notes}`;
  return system;
}
```

## Why two files?

Separation of concerns. `identity.md` is the **constitution** — stable, human-controlled. `notes.md` is the **scratchpad** — dynamic, agent-controlled. You never want the agent rewriting its own identity.

## What's next

The agent can now remember, but it runs on your bare machine. In the next step, we put it inside Docker so it can't break anything when we give it more powerful tools.
