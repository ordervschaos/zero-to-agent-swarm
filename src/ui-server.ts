import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as path from "node:path";
import { logBus } from "./log-events.js";
import { listAgents, loadAgentConfig } from "./config.js";
import { initMemory } from "./memory.js";
import { setActiveAgent } from "./tools.js";
import { Agent } from "./agent.js";

const PORT = parseInt(process.env.UI_PORT ?? "3000");
const __dir = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(__dir, "..");
const WORKSPACE_DIR = path.join(ROOT, "workspace");
const UI_DIR = path.join(ROOT, "ui");
const TASKS_PATH = path.join(WORKSPACE_DIR, "tasks.json");
const ARTIFACTS_PATH = path.join(WORKSPACE_DIR, "artifacts.json");

// Ensure workspace exists
mkdirSync(WORKSPACE_DIR, { recursive: true });
if (!existsSync(TASKS_PATH)) writeFileSync(TASKS_PATH, "[]");
if (!existsSync(ARTIFACTS_PATH)) writeFileSync(ARTIFACTS_PATH, "[]");

// --- SSE clients ---

interface SseClient {
  res: ServerResponse;
  id: number;
}

let clientId = 0;
const clients = new Set<SseClient>();

function sendSse(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

function broadcast(event: string, data: unknown): void {
  for (const client of clients) sendSse(client, event, data);
}

// --- Watch workspace files ---

function watchWorkspaceFile(filePath: string, eventName: string): void {
  try {
    watch(filePath, () => {
      try {
        broadcast(eventName, JSON.parse(readFileSync(filePath, "utf-8")));
      } catch {}
    });
  } catch {}
}

watchWorkspaceFile(TASKS_PATH, "tasks");
watchWorkspaceFile(ARTIFACTS_PATH, "artifacts");

// Forward log events to SSE clients
logBus.on("log", (event) => broadcast("log", event));

// --- Agent instances (persist conversation history per agent) ---

const agentCache = new Map<string, Agent>();

function getAgent(agentName: string, reset = false): Agent {
  if (reset || !agentCache.has(agentName)) {
    const config = loadAgentConfig(agentName);
    initMemory(config);
    agentCache.set(agentName, new Agent(config));
  }
  return agentCache.get(agentName)!;
}

// --- Request helpers ---

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

// --- HTTP server ---

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const method = req.method ?? "GET";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Serve UI
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.writeHead(200);
    res.end(readFileSync(path.join(UI_DIR, "index.html"), "utf-8"));
    return;
  }

  // GET /api/agents
  if (pathname === "/api/agents" && method === "GET") {
    const agents = listAgents().map((name) => {
      const cfg = loadAgentConfig(name);
      return { name, description: cfg.description };
    });
    json(res, agents);
    return;
  }

  // GET /api/tasks
  if (pathname === "/api/tasks" && method === "GET") {
    try { json(res, JSON.parse(readFileSync(TASKS_PATH, "utf-8"))); }
    catch { json(res, []); }
    return;
  }

  // GET /api/artifacts
  if (pathname === "/api/artifacts" && method === "GET") {
    try { json(res, JSON.parse(readFileSync(ARTIFACTS_PATH, "utf-8"))); }
    catch { json(res, []); }
    return;
  }

  // GET /api/events — SSE stream
  if (pathname === "/api/events" && method === "GET") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.writeHead(200);

    const client: SseClient = { res, id: ++clientId };
    clients.add(client);
    req.on("close", () => clients.delete(client));

    // Send initial state
    try { sendSse(client, "tasks", JSON.parse(readFileSync(TASKS_PATH, "utf-8"))); } catch {}
    try { sendSse(client, "artifacts", JSON.parse(readFileSync(ARTIFACTS_PATH, "utf-8"))); } catch {}

    // Keepalive ping every 25s
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
    }, 25_000);
    req.on("close", () => clearInterval(ping));
    return;
  }

  // POST /api/chat
  if (pathname === "/api/chat" && method === "POST") {
    try {
      const body = await readBody(req);
      const { agent: agentName, message, reset } = JSON.parse(body);

      if (!agentName || !message) {
        json(res, { error: "agent and message required" }, 400);
        return;
      }

      const agent = getAgent(agentName, reset === true);
      setActiveAgent(agentName);
      const response = await agent.run(message);
      json(res, { response });
    } catch (err: any) {
      json(res, { error: err?.message ?? String(err) }, 500);
    }
    return;
  }

  // POST /api/clear
  if (pathname === "/api/clear" && method === "POST") {
    writeFileSync(TASKS_PATH, "[]");
    writeFileSync(ARTIFACTS_PATH, "[]");
    agentCache.clear();
    broadcast("tasks", []);
    broadcast("artifacts", []);
    json(res, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  Agent Swarm UI  →  http://localhost:${PORT}\n`);
});
