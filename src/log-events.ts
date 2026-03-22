import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export interface LogEvent {
  type: string;
  agent: string;
  data: Record<string, unknown>;
  timestamp: string;
}

const WORKSPACE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "workspace");
const EVENTS_PATH = path.join(WORKSPACE_DIR, "events.jsonl");

mkdirSync(WORKSPACE_DIR, { recursive: true });

export const logBus = new EventEmitter();
logBus.setMaxListeners(100);

// Persist every event to workspace/events.jsonl
logBus.on("log", (event: LogEvent) => {
  try {
    appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n");
  } catch {}
});
