import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PROJECTS_DIR = path.join(APP_DIR, "projects");

export interface ProjectConfig {
  name: string;
  description: string;
  goal: string;
  team: Record<string, "manager" | "contributor">;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  assignee: string;
  createdBy: string;
  result: string;
}

export function loadProjectConfig(name: string): ProjectConfig {
  const configPath = path.join(PROJECTS_DIR, `${name}.json`);
  if (!fs.existsSync(configPath)) {
    const defaultConfig: ProjectConfig = {
      name,
      description: `Project: ${name}`,
      goal: "Define your project goal here",
      team: {
        default: "manager",
        coder: "contributor",
        writer: "contributor",
        researcher: "contributor",
      },
    };
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`Created default project config: ${configPath}`);
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

export function listProjects(): string[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

export function initProject(config: ProjectConfig): void {
  const projectDir = path.join(PROJECTS_DIR, config.name);
  fs.mkdirSync(projectDir, { recursive: true });
  const tasksPath = path.join(projectDir, "tasks.json");
  const logPath = path.join(projectDir, "log.md");
  if (!fs.existsSync(tasksPath)) fs.writeFileSync(tasksPath, "[]");
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, `# ${config.name} — Project Log\n\n`);
}

function tasksPath(projectName: string): string {
  return path.join(PROJECTS_DIR, projectName, "tasks.json");
}

function logPath(projectName: string): string {
  return path.join(PROJECTS_DIR, projectName, "log.md");
}

function loadTasks(projectName: string): Task[] {
  return JSON.parse(fs.readFileSync(tasksPath(projectName), "utf-8"));
}

function saveTasks(projectName: string, tasks: Task[]): void {
  fs.writeFileSync(tasksPath(projectName), JSON.stringify(tasks, null, 2));
}

export function createTask(projectName: string, task: Omit<Task, "id" | "status" | "result">): Task {
  const tasks = loadTasks(projectName);
  const id = `task-${String(tasks.length + 1).padStart(3, "0")}`;
  const newTask: Task = { id, ...task, status: "todo", result: "" };
  tasks.push(newTask);
  saveTasks(projectName, tasks);
  return newTask;
}

export function updateTask(projectName: string, taskId: string, updates: Partial<Pick<Task, "status" | "result">>): Task | null {
  const tasks = loadTasks(projectName);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  if (updates.status) task.status = updates.status;
  if (updates.result !== undefined) task.result = updates.result;
  saveTasks(projectName, tasks);
  return task;
}

export function getTasks(projectName: string, filter?: { status?: string; assignee?: string }): Task[] {
  let tasks = loadTasks(projectName);
  if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
  if (filter?.assignee) tasks = tasks.filter((t) => t.assignee === filter.assignee);
  return tasks;
}

export function appendProjectLog(projectName: string, entry: string): void {
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  fs.appendFileSync(logPath(projectName), `- [${timestamp}] ${entry}\n`);
}

export function loadProjectLog(projectName: string): string {
  return fs.readFileSync(logPath(projectName), "utf-8");
}

export function getRole(projectName: string, agentName: string): "manager" | "contributor" | null {
  const config = loadProjectConfig(projectName);
  return config.team[agentName] ?? null;
}
