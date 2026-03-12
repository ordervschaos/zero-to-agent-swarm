// SQLite-backed task queue — agents poll for tasks assigned to them.

import Database from "better-sqlite3";
import * as path from "node:path";

export type TaskStatus = "pending" | "in-progress" | "done" | "failed";

export interface Task {
  id: number;
  description: string;
  assigned_to: string;
  status: TaskStatus;
  result: string | null;
  created_at: string;
}

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DB_PATH = path.join(APP_DIR, "tasks.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT    NOT NULL,
    assigned_to TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    result      TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Prepared statements
const insertStmt = db.prepare(
  `INSERT INTO tasks (description, assigned_to) VALUES (?, ?)`
);
const claimStmt = db.prepare(
  `UPDATE tasks SET status = 'in-progress'
   WHERE id = (SELECT id FROM tasks WHERE assigned_to = ? AND status = 'pending' ORDER BY id LIMIT 1)
   RETURNING *`
);
const completeStmt = db.prepare(
  `UPDATE tasks SET status = 'done', result = ? WHERE id = ?`
);
const failStmt = db.prepare(
  `UPDATE tasks SET status = 'failed', result = ? WHERE id = ?`
);

/** Add a new task to the queue. */
export function enqueue(description: string, assignedTo: string): Task {
  const info = insertStmt.run(description, assignedTo);
  const task: Task = {
    id: info.lastInsertRowid as number,
    description,
    assigned_to: assignedTo,
    status: "pending",
    result: null,
    created_at: new Date().toISOString(),
  };
  console.log(`  [queue] added task-${task.id} → ${assignedTo}: "${description}"`);
  return task;
}

/** Claim the next pending task for a given agent. Returns null if none. */
export function claim(agentName: string): Task | null {
  const row = claimStmt.get(agentName) as Task | undefined;
  return row ?? null;
}

/** Mark a task as done. */
export function complete(taskId: number, result: string): void {
  completeStmt.run(result, taskId);
  console.log(`  [queue] task-${taskId} done.`);
}

/** Mark a task as failed. */
export function fail(taskId: number, result: string): void {
  failStmt.run(result, taskId);
  console.log(`  [queue] task-${taskId} failed.`);
}
