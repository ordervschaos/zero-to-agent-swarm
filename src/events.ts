/**
 * Structured event log — the observability backbone.
 *
 * Every significant thing that happens in the swarm (task lifecycle,
 * tool calls, agent responses) is appended here as a JSON line.
 * All processes write to the same file, giving a unified timeline.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORKSPACE_DIR = path.join(APP_DIR, "workspace");
const EVENTS_PATH = path.join(WORKSPACE_DIR, "events.jsonl");

export type EventType =
  | "agent_started"
  | "task_posted"
  | "task_claimed"
  | "task_completed"
  | "tool_called"
  | "agent_response";

// Set once per process at startup — shared across delegations in the same run.
let runId = "";
let currentAgent = "";

export function setRunId(id: string): void {
  runId = id;
}

export function setEventAgent(name: string): void {
  currentAgent = name;
}

export function getEventAgent(): string {
  return currentAgent;
}

export function logEvent(type: EventType, data: Record<string, unknown> = {}): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    runId,
    agentName: currentAgent,
    type,
    data,
  };
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n");
}
