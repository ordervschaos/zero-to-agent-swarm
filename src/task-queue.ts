// SQLite-backed task queue — agents poll for tasks assigned to them.

import Database from "better-sqlite3";
import * as path from "node:path";

export type TaskStatus = "pending" | "in-progress" | "done" | "failed" | "blocked";

export interface Task {
  id: number;
  description: string;
  assigned_to: string;
  status: TaskStatus;
  result: string | null;
  parent_id: number | null;
  depends_on: number[];
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
    parent_id   INTEGER,
    depends_on  TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Prepared statements
const insertStmt = db.prepare(
  `INSERT INTO tasks (description, assigned_to, status, parent_id, depends_on)
   VALUES (?, ?, ?, ?, ?)`
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
const getTaskStmt = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
const getSubtasksStmt = db.prepare(`SELECT * FROM tasks WHERE parent_id = ?`);
const getAllStmt = db.prepare(`SELECT * FROM tasks ORDER BY id`);
const getBlockedStmt = db.prepare(`SELECT * FROM tasks WHERE status = 'blocked'`);
const unblockStmt = db.prepare(`UPDATE tasks SET status = 'pending' WHERE id = ?`);
const clearAllStmt = db.prepare(`DELETE FROM tasks`);

/** Parse a raw DB row into a Task with depends_on as number[]. */
function parseRow(row: any): Task {
  return {
    ...row,
    depends_on: JSON.parse(row.depends_on ?? "[]"),
  };
}

/** Add a new task with optional dependencies and parent. */
export function enqueueWithDeps(
  description: string,
  assignedTo: string,
  opts: { parentId?: number; dependsOn?: number[] } = {}
): Task {
  const deps = opts.dependsOn ?? [];
  const status = deps.length > 0 ? "blocked" : "pending";
  const info = insertStmt.run(
    description,
    assignedTo,
    status,
    opts.parentId ?? null,
    JSON.stringify(deps)
  );
  const task: Task = {
    id: info.lastInsertRowid as number,
    description,
    assigned_to: assignedTo,
    status,
    result: null,
    parent_id: opts.parentId ?? null,
    depends_on: deps,
    created_at: new Date().toISOString(),
  };
  if (deps.length > 0) {
    console.log(`  [queue] added task-${task.id} → ${assignedTo}: "${description}" (blocked by [${deps.join(", ")}])`);
  } else {
    console.log(`  [queue] added task-${task.id} → ${assignedTo}: "${description}"`);
  }
  return task;
}

/** Add a new task to the queue (backward-compatible). */
export function enqueue(description: string, assignedTo: string): Task {
  return enqueueWithDeps(description, assignedTo);
}

/** Claim the next pending task for a given agent. Returns null if none. */
export function claim(agentName: string): Task | null {
  const row = claimStmt.get(agentName) as any | undefined;
  return row ? parseRow(row) : null;
}

/** Mark a task as done and unblock dependent tasks. */
export function complete(taskId: number, result: string): void {
  completeStmt.run(result, taskId);
  console.log(`  [queue] task-${taskId} done.`);

  // Unblock tasks whose dependencies are now all met
  const blocked = getBlockedStmt.all() as any[];
  for (const row of blocked) {
    const deps: number[] = JSON.parse(row.depends_on ?? "[]");
    if (deps.length === 0) continue;

    const allDone = deps.every((depId) => {
      const dep = getTaskStmt.get(depId) as any;
      return dep?.status === "done";
    });

    if (allDone) {
      unblockStmt.run(row.id);
      console.log(`  [queue] task-${row.id} unblocked → pending`);
    }
  }
}

/** Mark a task as failed. */
export function fail(taskId: number, result: string): void {
  failStmt.run(result, taskId);
  console.log(`  [queue] task-${taskId} failed.`);
}

/** Get a single task by ID. */
export function getTask(id: number): Task | null {
  const row = getTaskStmt.get(id) as any | undefined;
  return row ? parseRow(row) : null;
}

/** Get all subtasks for a parent task. */
export function getSubtasks(parentId: number): Task[] {
  return (getSubtasksStmt.all(parentId) as any[]).map(parseRow);
}

/** Get all tasks. */
export function getAllTasks(): Task[] {
  return (getAllStmt.all() as any[]).map(parseRow);
}

/** Delete all tasks from the queue. */
export function clearAll(): void {
  clearAllStmt.run();
  console.log(`  [queue] all tasks cleared.`);
}

/** Get results from all dependency tasks for a given task. */
export function getDependencyResults(taskId: number): Record<number, string> {
  const task = getTask(taskId);
  if (!task) return {};
  const results: Record<number, string> = {};
  for (const depId of task.depends_on) {
    const dep = getTask(depId);
    if (dep?.result) results[depId] = dep.result;
  }
  return results;
}
