/**
 * Global Workspace — shared state for agent coordination.
 *
 * The workspace is a directory on disk with two stores:
 *   - tasks.json   — a shared task list any agent can post to, claim, or complete
 *   - artifacts.json — a key-value store for sharing data between agents
 */

import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORKSPACE_DIR = path.join(APP_DIR, "workspace");
const TASKS_PATH = path.join(WORKSPACE_DIR, "tasks.json");
const ARTIFACTS_PATH = path.join(WORKSPACE_DIR, "artifacts.json");

// --- Initialize workspace directory ---

function ensureWorkspace(): void {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!fs.existsSync(TASKS_PATH)) fs.writeFileSync(TASKS_PATH, "[]");
  if (!fs.existsSync(ARTIFACTS_PATH)) fs.writeFileSync(ARTIFACTS_PATH, "[]");
}

// --- Tasks ---

export interface Task {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  assignee: string;
  postedBy: string;
  result: string;
  projectId?: string;
  dependsOn?: string[];
  parentId?: string;
  isContainer?: boolean;
  siblingSequential?: boolean;
  siblingIndex?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}

function loadTasks(): Task[] {
  ensureWorkspace();
  return JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8"));
}

function saveTasks(tasks: Task[]): void {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
}

export function postTask(title: string, postedBy: string): string {
  const tasks = loadTasks();
  const id = `task-${String(tasks.length + 1).padStart(3, "0")}`;
  const task: Task = { id, title, status: "open", assignee: "", postedBy, result: "", createdAt: new Date().toISOString() };
  tasks.push(task);
  saveTasks(tasks);
  return `Posted ${id}: "${title}"`;
}

export function listTasks(status?: string): string {
  const tasks = loadTasks();
  const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
  if (filtered.length === 0) return status ? `No ${status} tasks.` : "No tasks in workspace.";
  return filtered
    .map((t) => `[${t.id}] ${t.status.toUpperCase()} — "${t.title}"${t.assignee ? ` (${t.assignee})` : ""}${t.result ? ` → ${t.result}` : ""}`)
    .join("\n");
}

export function updateTask(taskId: string, agent: string, action: "claim" | "complete", result?: string): string {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return `Task not found: ${taskId}`;

  if (action === "claim") {
    if (task.status !== "open") return `Cannot claim ${taskId} — status is ${task.status}.`;
    task.status = "in_progress";
    task.assignee = agent;
    task.startedAt = new Date().toISOString();
    saveTasks(tasks);
    return `Claimed ${taskId}: "${task.title}"`;
  }

  if (action === "complete") {
    if (task.status !== "in_progress") return `Cannot complete ${taskId} — status is ${task.status}.`;
    task.status = "done";
    task.result = result || "done";
    task.completedAt = new Date().toISOString();
    saveTasks(tasks);
    return `Completed ${taskId}: "${task.title}"`;
  }

  return `Unknown action: ${action}. Use "claim" or "complete".`;
}

export function postDagTask(
  id: string,
  title: string,
  dependsOn: string[],
  projectId: string,
  postedBy: string,
  opts?: {
    parentId?: string;
    isContainer?: boolean;
    siblingSequential?: boolean;
    siblingIndex?: number;
  }
): void {
  const tasks = loadTasks();
  const task: Task = {
    id,
    title,
    status: "open",
    assignee: "",
    postedBy,
    result: "",
    projectId,
    dependsOn,
    parentId: opts?.parentId,
    isContainer: opts?.isContainer,
    siblingSequential: opts?.siblingSequential,
    siblingIndex: opts?.siblingIndex,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks(tasks);
}

export function getProjectStatus(projectId: string): string {
  const tasks = loadTasks().filter((t) => t.projectId === projectId);
  if (tasks.length === 0) return `No tasks for project ${projectId}.`;
  const done = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const open = tasks.filter((t) => t.status === "open").length;
  const lines = tasks.map((t) => {
    const deps = t.dependsOn?.length ? ` [needs: ${t.dependsOn.join(", ")}]` : "";
    return `  [${t.id}] ${t.status.toUpperCase()} — ${t.title}${deps}`;
  });
  return (
    `Project ${projectId}: ${done}/${tasks.length} done` +
    (inProgress ? `, ${inProgress} in progress` : "") +
    (open ? `, ${open} open` : "") +
    `\n${lines.join("\n")}`
  );
}

// --- Artifacts ---

export interface Artifact {
  key: string;
  value: string;
  author: string;
  timestamp: string;
}

function loadArtifacts(): Artifact[] {
  ensureWorkspace();
  return JSON.parse(fs.readFileSync(ARTIFACTS_PATH, "utf-8"));
}

function saveArtifacts(artifacts: Artifact[]): void {
  fs.writeFileSync(ARTIFACTS_PATH, JSON.stringify(artifacts, null, 2));
}

export function writeArtifact(key: string, value: string, author: string): string {
  const artifacts = loadArtifacts();
  const existing = artifacts.findIndex((a) => a.key === key);
  const artifact: Artifact = { key, value, author, timestamp: new Date().toISOString() };
  if (existing >= 0) artifacts[existing] = artifact;
  else artifacts.push(artifact);
  saveArtifacts(artifacts);
  return `Written artifact "${key}" to workspace.`;
}

export function readArtifact(key?: string): string {
  const artifacts = loadArtifacts();
  if (key) {
    const artifact = artifacts.find((a) => a.key === key);
    if (!artifact) return `No artifact "${key}". Available: ${artifacts.map((a) => a.key).join(", ") || "(none)"}`;
    return `[${artifact.key}] by ${artifact.author} (${artifact.timestamp}):\n${artifact.value}`;
  }
  if (artifacts.length === 0) return "No artifacts in workspace.";
  return artifacts
    .map((a) => `[${a.key}] by ${a.author} (${a.timestamp}):\n${a.value}`)
    .join("\n\n---\n\n");
}
