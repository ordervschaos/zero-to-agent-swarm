# src/ — Agent Swarm Runtime

TypeScript source, compiled via `tsx` (no separate build step in dev). Entry: `src/index.ts`.

## Module Overview

| File | Responsibility |
|------|---------------|
| `index.ts` | Entry point — loads `.env.local`, reads agent name from `AGENT_NAME` env or CLI arg, initialises memory, wires triggers |
| `agent.ts` | `Agent` class — holds conversation history, runs the agentic loop (tool-call → response cycle), handles delegation |
| `config.ts` | `AgentConfig` type, loads JSON genomes from `agents/` dir |
| `llm.ts` | Thin wrapper around `@google/genai` — `chat()` sends history + system prompt + tools to `gemini-2.0-flash` |
| `memory.ts` | Per-agent file-based memory — `initMemory` ensures `notes.md` exists, `loadMemory` assembles system prompt from `identity.md` + `notes.md` |
| `tools.ts` | Tool declarations (Gemini `FunctionDeclaration` schema) + `executeTool` dispatcher |
| `triggers.ts` | Three trigger types: REPL (stdin), file watcher (`WATCH_DIR`), clock (`CRON_SCHEDULE`) |
| `workspace.ts` | Global workspace — `tasks.json` (claim/complete lifecycle) + `artifacts.json` (key-value store) |
| `display.ts` | Console output helpers |

## Key Patterns

**Agentic loop** (`agent.ts:72`): Sends history to LLM, if response has a `functionCall` executes the tool and appends result to history, repeats until a text response is returned or `maxIterations` is hit (default 10).

**Delegation** (`tools.ts:219`): `ask_agent` spins up a fresh `Agent` instance inline, swaps `activeAgent` for context tracking, calls `agent.run()`, restores parent context. Self-delegation is blocked.

**System prompt** = `agents/<name>/identity.md` + `agents/<name>/notes.md` entries + auto-generated swarm roster (other agents' names and descriptions).

**Tool registry** (`tools.ts:175`): Tools are registered by string key; agent JSONs reference them by name in `tools: []`. `getDeclarations` filters the registry to the agent's allowed tools.

## Environment Variables

| Variable | Used by | Effect |
|----------|---------|--------|
| `GEMINI_API_KEY` | `llm.ts` | Required — Gemini API key |
| `AGENT_NAME` | `index.ts` | Which agent genome to load (default: `default`) |
| `WATCH_DIR` | `triggers.ts` | Directory to watch for file changes |
| `CRON_SCHEDULE` | `triggers.ts` | `*/N * * * *` style only; fires every N minutes |
| `CRON_PROMPT` | `triggers.ts` | Message sent on each clock tick |

## Adding a New Tool

1. Add a `FunctionDeclaration` export in `tools.ts`
2. Add it to `toolRegistry`
3. Add a `case` in `executeTool`
4. List the tool name in any agent JSON that should have access
