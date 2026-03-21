# Phase 3, Step 3.5: Web UI — A Live Dashboard for the Swarm

## What you'll learn

- How to expose a running agent swarm through an HTTP server
- How Server-Sent Events (SSE) push real-time updates to the browser
- How to wire a single-file frontend to a Node.js API without a build step

## The big idea

The swarm is working — but watching it means reading JSON files and terminal logs. A web UI gives you a live window into everything happening at once: tasks moving through the kanban, agents chatting, artifacts accumulating, log events streaming in.

The key architectural idea is the **event bus** (`log-events.ts`): a Node.js `EventEmitter` that agents write to, and the UI server reads from. The server holds a set of SSE connections and forwards every bus event to every browser. The browser never polls — it just listens.

```
Agent loop
  │  emits on logBus
  ▼
ui-server.ts
  │  broadcasts via SSE
  ▼
browser (EventSource)
  │  updates DOM in real time
  ▼
Kanban · Chat · Artifacts · Logs
```

## Steps

### 1. Add the event bus — `src/log-events.ts`

A tiny shared `EventEmitter` that any module can import and emit to. `agent.ts` and `tools.ts` already call `logBus.emit('log', event)` — this is what feeds the Logs panel.

```ts
import { EventEmitter } from "node:events";
export const logBus = new EventEmitter();
logBus.setMaxListeners(100);
```

### 2. Build the HTTP server — `src/ui-server.ts`

One Node.js `http.createServer` handles everything:

| Route | Method | What it does |
|-------|--------|--------------|
| `/` | GET | Serves `ui/index.html` |
| `/api/agents` | GET | Lists agent genomes from `agents/` |
| `/api/tasks` | GET | Returns `workspace/tasks.json` |
| `/api/artifacts` | GET | Returns `workspace/artifacts.json` |
| `/api/events` | GET | Opens an SSE stream |
| `/api/chat` | POST | Sends a message to an agent, returns reply |
| `/api/clear` | POST | Resets tasks, artifacts, and all chat histories |

**SSE** (`/api/events`): each browser tab registers as a client. The server watches `tasks.json` and `artifacts.json` with `fs.watch` and broadcasts on change. Log events come from the `logBus`. On first connect, the server sends current tasks and artifacts so the page loads with the right state.

**Agent cache**: `getAgent(name, reset?)` keeps one `Agent` instance per name so conversation history persists across chat messages. `POST /api/chat` with `reset: true` (or the Reset button) discards history and starts fresh.

### 3. Build the frontend — `ui/index.html`

A single HTML file with inline CSS and JS — no bundler, no framework.

**Layout** (CSS grid):

```
┌─────────────────┬─────────────────┐
│   Tasks kanban  │    Artifacts    │  ← 44% height
├─────────────────┼─────────────────┤
│   Chat          │    Logs         │  ← 56% height
└─────────────────┴─────────────────┘
```

**SSE client**: `new EventSource('/api/events')` — listens for `tasks`, `artifacts`, and `log` events and updates the DOM directly. Reconnects automatically on drop.

**Chat**: picks up the selected agent from the dropdown, POSTs to `/api/chat`, appends messages. The Reset button clears local history and tells the server to reset that agent's conversation.

## How to try it

```bash
npm run ui
# opens on http://localhost:3000
```

Then in a separate terminal, run any agent:

```bash
AGENT_NAME=manager npm start
# or: AGENT_NAME=coder npm start
```

The UI will show tasks populating the kanban, artifacts appearing, and agent log events streaming in as the agents work. You can also chat directly with any agent from the browser while the swarm is running.
