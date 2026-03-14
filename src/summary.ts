// Summary event system — fires when all subtasks of a project complete.
// Listeners (dashboard, REPL, etc.) subscribe to receive summaries.

export interface SubtaskResult {
  agent: string;
  description: string;
  result: string;
}

export interface Summary {
  project: string;
  subtasks: SubtaskResult[];
  text: string;
}

type SummaryListener = (summary: Summary) => void;
const listeners: SummaryListener[] = [];

/** Subscribe to summary events. */
export function onSummary(callback: SummaryListener): void {
  listeners.push(callback);
}

/** Emit a summary to all listeners. */
export function emitSummary(summary: Summary): void {
  for (const cb of listeners) {
    cb(summary);
  }
}
