/**
 * Swarm UI — a minimal dashboard for observing and steering the agent swarm.
 *
 * Surfaces:
 *   - Task board: tasks by status (open / in_progress / done)
 *   - Event stream: live feed from workspace/events.jsonl
 *   - Artifacts: key-value store written by agents
 *
 * No frameworks, no build step. Pure Node HTTP + inline HTML.
 * Run with: npm run ui  (port 3001)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Load .env.local (same as index.ts)
const envPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

import * as http from "node:http";
import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { setActiveAgent } from "./tools.js";
import { setEventAgent, setRunId } from "./events.js";
import { writeArtifact } from "./workspace.js";

const PORT = 3001;
const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORKSPACE_DIR = path.join(APP_DIR, "workspace");
const TASKS_PATH = path.join(WORKSPACE_DIR, "tasks.json");
const ARTIFACTS_PATH = path.join(WORKSPACE_DIR, "artifacts.json");
const EVENTS_PATH = path.join(WORKSPACE_DIR, "events.jsonl");
const SETTINGS_PATH = path.join(WORKSPACE_DIR, "settings.json");

// --- Data readers ---

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function readEvents(limit = 100): unknown[] {
  try {
    const lines = fs.readFileSync(EVENTS_PATH, "utf-8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// --- SSE helpers ---

const sseClients = new Set<http.ServerResponse>();

function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// --- Chat ---
// Persistent agent instances so conversation history is retained across messages.
const chatAgents = new Map<string, Agent>();
let chatBusy = false;

async function runChat(agentName: string, message: string): Promise<string> {
  if (chatBusy) return "[busy — another message is in flight]";
  chatBusy = true;
  try {
    if (!chatAgents.has(agentName)) {
      const config = loadAgentConfig(agentName);
      initMemory(config);
      chatAgents.set(agentName, new Agent(config));
    }
    setActiveAgent(agentName);
    setEventAgent(agentName);
    setRunId(`chat-${Date.now().toString(36)}`);
    return await chatAgents.get(agentName)!.run(message);
  } finally {
    chatBusy = false;
  }
}

// Watch events.jsonl and broadcast new lines as SSE
let eventsFileSize = 0;
function watchEvents(): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_PATH)) fs.writeFileSync(EVENTS_PATH, "");
  eventsFileSize = fs.statSync(EVENTS_PATH).size;

  fs.watch(EVENTS_PATH, () => {
    try {
      const stat = fs.statSync(EVENTS_PATH);
      if (stat.size <= eventsFileSize) return;
      const fd = fs.openSync(EVENTS_PATH, "r");
      const buf = Buffer.alloc(stat.size - eventsFileSize);
      fs.readSync(fd, buf, 0, buf.length, eventsFileSize);
      fs.closeSync(fd);
      eventsFileSize = stat.size;
      for (const line of buf.toString().split("\n").filter(Boolean)) {
        try { broadcastSSE({ type: "event", data: JSON.parse(line) }); } catch { /* skip malformed */ }
      }
    } catch { /* file may not exist yet */ }
  });
}

// --- HTML ---

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swarm Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #0d1117; color: #c9d1d9; font-size: 13px; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #21262d; background: #161b22; }
    h1 { font-size: 14px; color: #58a6ff; font-weight: bold; letter-spacing: 0.05em; }
    .mode-badge { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; cursor: pointer; }
    .mode-autonomous { background: #1f6feb33; color: #58a6ff; border: 1px solid #1f6feb; }
    .mode-supervised { background: #3d1a0033; color: #f78166; border: 1px solid #f78166; }
    .layout { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1px; background: #21262d; height: calc(100vh - 45px); }
    .panel { background: #0d1117; display: flex; flex-direction: column; overflow: hidden; }
    .panel-header { padding: 8px 14px; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #21262d; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
    .panel-body { flex: 1; overflow-y: auto; padding: 10px 14px; }

    /* Task board */
    .task-columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .col-header { font-size: 10px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.08em; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #21262d; }
    .task-card { padding: 7px 9px; margin-bottom: 5px; border-radius: 4px; border-left: 3px solid #21262d; font-size: 12px; line-height: 1.4; }
    .task-card.open { border-left-color: #8b949e; background: #161b22; }
    .task-card.in_progress { border-left-color: #d29922; background: #1c1800; }
    .task-card.done { border-left-color: #3fb950; background: #0d1f0e; }
    .task-card.blocked { border-left-color: #f78166; background: #1a0d0d; }
    .task-meta { font-size: 10px; color: #8b949e; margin-top: 3px; }
    .task-result { font-size: 10px; color: #8b949e; margin-top: 3px; font-style: italic; }

    /* Event log */
    .event-row { padding: 3px 0; border-bottom: 1px solid #161b22; display: flex; gap: 8px; align-items: baseline; }
    .event-time { color: #8b949e; flex-shrink: 0; font-size: 11px; }
    .event-agent { color: #79c0ff; flex-shrink: 0; min-width: 80px; }
    .event-type { flex-shrink: 0; min-width: 120px; }
    .event-type.agent_started { color: #56d364; }
    .event-type.task_posted { color: #58a6ff; }
    .event-type.task_claimed { color: #d29922; }
    .event-type.task_completed { color: #3fb950; }
    .event-type.tool_called { color: #bc8cff; }
    .event-type.agent_response { color: #8b949e; }
    .event-data { color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Artifacts */
    .artifact { margin-bottom: 10px; border: 1px solid #21262d; border-radius: 4px; overflow: hidden; }
    .artifact-header { padding: 5px 10px; background: #161b22; font-size: 11px; display: flex; justify-content: space-between; color: #8b949e; }
    .artifact-key { color: #bc8cff; font-weight: bold; }
    .artifact-body { padding: 8px 10px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 100px; overflow-y: auto; }
    .artifact.pending { border-color: #d29922; }
    .artifact.pending .artifact-header { background: #1c1800; }
    .approve-btn { background: #3fb950; color: #000; border: none; padding: 2px 10px; border-radius: 3px; font-family: monospace; font-size: 11px; cursor: pointer; font-weight: bold; }
    .approve-btn:hover { background: #56d364; }

    /* Chat */
    .chat-panel { display: flex; flex-direction: column; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
    .chat-msg { max-width: 85%; line-height: 1.5; padding: 8px 11px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
    .chat-msg.user { align-self: flex-end; background: #1f6feb; color: #fff; border-bottom-right-radius: 2px; }
    .chat-msg.agent { align-self: flex-start; background: #161b22; border: 1px solid #21262d; border-bottom-left-radius: 2px; }
    .chat-msg.thinking { align-self: flex-start; color: #8b949e; font-style: italic; background: transparent; border: none; padding: 4px 0; }
    .chat-input-row { padding: 10px 14px; border-top: 1px solid #21262d; display: flex; gap: 8px; flex-shrink: 0; }
    .agent-select { background: #161b22; border: 1px solid #21262d; color: #c9d1d9; padding: 5px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; cursor: pointer; }
    .chat-input { flex: 1; background: #161b22; border: 1px solid #21262d; color: #c9d1d9; padding: 6px 10px; border-radius: 4px; font-family: monospace; font-size: 12px; outline: none; }
    .chat-input:focus { border-color: #58a6ff; }
    .send-btn { background: #1f6feb; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: monospace; font-size: 12px; }
    .send-btn:disabled { opacity: 0.4; cursor: default; }
    .send-btn:hover:not(:disabled) { background: #388bfd; }
    .chat-msg.system { align-self: center; color: #8b949e; font-size: 11px; font-style: italic; background: transparent; border: none; padding: 2px 0; }

    /* Stats */
    .stats { display: flex; gap: 16px; align-items: center; }
    .stat { font-size: 11px; color: #8b949e; }
    .stat span { font-weight: bold; }
    .stat .open { color: #8b949e; }
    .stat .in-progress { color: #d29922; }
    .stat .done { color: #3fb950; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 2px; }
  </style>
</head>
<body>
  <header>
    <h1>▶ Swarm Dashboard</h1>
    <div class="stats" id="stats"></div>
    <div id="mode-badge" class="mode-badge mode-autonomous" onclick="cycleMode()">autonomous</div>
  </header>
  <div class="layout">
    <div class="panel">
      <div class="panel-header">Tasks</div>
      <div class="panel-body" id="task-board"></div>
    </div>
    <div class="panel">
      <div class="panel-header">Event Log</div>
      <div class="panel-body" id="event-log"></div>
    </div>
    <div class="panel chat-panel">
      <div class="panel-header">
        <span>Chat</span>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <select class="agent-select" id="agent-select"></select>
        <input class="chat-input" id="chat-input" placeholder="Message the swarm..." autocomplete="off" />
        <button class="send-btn" id="send-btn" onclick="sendMessage()">Send</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">Artifacts</div>
      <div class="panel-body" id="artifacts"></div>
    </div>
  </div>

  <script>
    function fmt(iso) {
      const d = new Date(iso);
      return d.toTimeString().slice(0,8);
    }

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function eventSummary(e) {
      const d = e.data;
      switch(e.type) {
        case 'task_posted': return d.title || '';
        case 'task_claimed': return d.title || '';
        case 'task_completed': return (d.result || '').slice(0, 80);
        case 'tool_called': return d.tool + (d.args?.command ? ': ' + String(d.args.command).slice(0,50) : d.args?.title ? ': ' + d.args.title : '');
        case 'agent_response': return (d.text || '').slice(0, 80);
        case 'agent_started': return d.description || '';
        default: return JSON.stringify(d).slice(0, 80);
      }
    }

    function renderTasks(tasks) {
      const cols = { open: [], in_progress: [], done: [] };
      tasks.forEach(t => {
        const isBlocked = t.status === 'open' && t.blockedBy?.length > 0;
        const card = \`<div class="task-card \${isBlocked ? 'blocked' : t.status}">
          <div>\${esc(t.title)}</div>
          <div class="task-meta">\${t.id}\${t.assignee ? ' · ' + t.assignee : ''}\${isBlocked ? ' · blocked' : ''}</div>
          \${t.result ? '<div class="task-result">' + esc(t.result.slice(0,80)) + '</div>' : ''}
        </div>\`;
        (cols[t.status] || cols.open).push(card);
      });
      const open = tasks.filter(t => t.status==='open').length;
      const ip = tasks.filter(t => t.status==='in_progress').length;
      const done = tasks.filter(t => t.status==='done').length;
      document.getElementById('stats').innerHTML =
        \`<div class="stat"><span class="open">\${open}</span> open</div>
         <div class="stat"><span class="in-progress">\${ip}</span> active</div>
         <div class="stat"><span class="done">\${done}</span> done</div>\`;
      document.getElementById('task-board').innerHTML = \`
        <div class="task-columns">
          <div><div class="col-header">Open</div>\${cols.open.join('')}</div>
          <div><div class="col-header">In Progress</div>\${cols.in_progress.join('')}</div>
          <div><div class="col-header">Done</div>\${cols.done.join('')}</div>
        </div>\`;
    }

    function renderEvents(events) {
      const rows = events.slice().reverse().map(e => \`
        <div class="event-row">
          <span class="event-time">\${fmt(e.timestamp)}</span>
          <span class="event-agent">\${e.agentName}</span>
          <span class="event-type \${e.type}">\${e.type}</span>
          <span class="event-data">\${esc(eventSummary(e))}</span>
        </div>\`).join('');
      document.getElementById('event-log').innerHTML = rows;
    }

    function renderArtifacts(artifacts) {
      if (!artifacts.length) {
        document.getElementById('artifacts').innerHTML = '<span style="color:#8b949e">No artifacts yet.</span>';
        return;
      }
      const approvedKeys = new Set(artifacts.filter(a => a.key.startsWith('approved-')).map(a => a.key));
      document.getElementById('artifacts').innerHTML = artifacts.map(a => {
        const isPendingPlan = a.key.startsWith('plan-') && !approvedKeys.has('approved-' + a.key.slice(5));
        const taskId = isPendingPlan ? a.key.slice(5) : null;
        return \`<div class="artifact \${isPendingPlan ? 'pending' : ''}">
          <div class="artifact-header">
            <span class="artifact-key">\${esc(a.key)}</span>
            <span style="display:flex;align-items:center;gap:8px">
              \${isPendingPlan ? \`<button class="approve-btn" onclick="approve('\${taskId}')">Approve</button>\` : ''}
              \${a.author} · \${fmt(a.timestamp)}
            </span>
          </div>
          <div class="artifact-body">\${esc(a.value)}</div>
        </div>\`;
      }).join('');
    }

    async function approve(taskId) {
      await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      refresh();
    }

    async function refresh() {
      const [tasks, events, artifacts, settings] = await Promise.all([
        fetch('/api/tasks').then(r=>r.json()),
        fetch('/api/events').then(r=>r.json()),
        fetch('/api/artifacts').then(r=>r.json()),
        fetch('/api/settings').then(r=>r.json()),
      ]);
      renderTasks(tasks);
      renderEvents(events);
      renderArtifacts(artifacts);
      const badge = document.getElementById('mode-badge');
      badge.textContent = settings.mode || 'autonomous';
      badge.className = 'mode-badge mode-' + (settings.mode || 'autonomous');
    }

    async function cycleMode() {
      const badge = document.getElementById('mode-badge');
      const next = badge.textContent === 'autonomous' ? 'supervised' : 'autonomous';
      await fetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mode: next }) });
      refresh();
    }

    // --- Chat ---
    function appendMessage(role, text) {
      const el = document.createElement('div');
      el.className = 'chat-msg ' + role;
      el.textContent = text;
      document.getElementById('chat-messages').appendChild(el);
      el.scrollIntoView({ behavior: 'smooth' });
      return el;
    }

    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const btn = document.getElementById('send-btn');
      const agentSelect = document.getElementById('agent-select');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      // Slash commands
      if (text === '/clear') {
        await fetch('/api/chat/clear', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ agent: agentSelect.value }) });
        document.getElementById('chat-messages').innerHTML = '';
        appendMessage('system', 'conversation history cleared');
        input.focus();
        return;
      }
      if (text === '/clear_all') {
        await fetch('/api/workspace/clear', { method: 'POST' });
        document.getElementById('chat-messages').innerHTML = '';
        appendMessage('system', 'tasks, events, and artifacts cleared');
        refresh();
        input.focus();
        return;
      }

      btn.disabled = true;
      appendMessage('user', text);
      const thinking = appendMessage('thinking', 'thinking…');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, agent: agentSelect.value }),
        });
        const data = await res.json();
        thinking.remove();
        appendMessage('agent', data.response);
        refresh();
      } catch (err) {
        thinking.remove();
        appendMessage('thinking', 'Error: ' + err.message);
      } finally {
        btn.disabled = false;
        input.focus();
      }
    }

    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    async function loadAgents() {
      const agents = await fetch('/api/agents').then(r=>r.json());
      const sel = document.getElementById('agent-select');
      sel.innerHTML = agents.map(a => \`<option value="\${a}">\${a}</option>\`).join('');
      // Default to manager if present
      if (agents.includes('manager')) sel.value = 'manager';
    }

    // Initial load + poll fallback
    loadAgents();
    refresh();
    setInterval(refresh, 3000);

    // SSE for live events
    const es = new EventSource('/api/events/stream');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'event') refresh();
    };
  </script>
</body>
</html>`;

// --- Server ---

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);

  } else if (url.pathname === "/api/tasks" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readJSON(TASKS_PATH, [])));

  } else if (url.pathname === "/api/artifacts" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readJSON(ARTIFACTS_PATH, [])));

  } else if (url.pathname === "/api/events" && req.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") ?? "100");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readEvents(limit)));

  } else if (url.pathname === "/api/settings" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readJSON(SETTINGS_PATH, { mode: "autonomous" })));

  } else if (url.pathname === "/api/settings" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const update = JSON.parse(body);
        const current = readJSON(SETTINGS_PATH, { mode: "autonomous" });
        const next = { ...current, ...update };
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(next));
      } catch {
        res.writeHead(400);
        res.end("Bad request");
      }
    });

  } else if (url.pathname === "/api/approve" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { taskId } = JSON.parse(body);
        writeArtifact(`approved-${taskId}`, "Approved", "human");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end("Bad request");
      }
    });

  } else if (url.pathname === "/api/chat/clear" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { agent: agentName } = JSON.parse(body);
        chatAgents.delete(agentName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end("Bad request");
      }
    });

  } else if (url.pathname === "/api/workspace/clear" && req.method === "POST") {
    fs.writeFileSync(EVENTS_PATH, "");
    fs.writeFileSync(ARTIFACTS_PATH, "[]");
    fs.writeFileSync(TASKS_PATH, "[]");
    eventsFileSize = 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

  } else if (url.pathname === "/api/agents" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listAgents()));

  } else if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { message, agent: agentName = "manager" } = JSON.parse(body);
        const response = await runChat(agentName, message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response, agent: agentName }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

  } else if (url.pathname === "/api/events/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));

  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`\n  Swarm dashboard → http://localhost:${PORT}\n`);
});

watchEvents();
