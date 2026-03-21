import { EventEmitter } from "node:events";

export interface LogEvent {
  type: string;
  agent: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export const logBus = new EventEmitter();
logBus.setMaxListeners(100);
