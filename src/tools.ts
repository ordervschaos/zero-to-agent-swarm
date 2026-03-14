import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { NOTES_PATH } from "./memory.js";
import { enqueue, enqueueWithDeps, complete, getAllTasks, getSubtasks } from "./task-queue.js";
import { listAgents } from "./config.js";

const BASH_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

// --- Declarations ---

export const bashDeclaration: FunctionDeclaration = {
  name: "bash",
  description:
    "Execute a shell command and return stdout/stderr. Use this to: create and write files, run scripts (python, node, etc.), install packages, explore the filesystem, or perform any task achievable from a terminal.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The shell command to execute.",
      },
    },
    required: ["command"],
  },
};

export const saveNoteDeclaration: FunctionDeclaration = {
  name: "save_note",
  description:
    "Save a note to persistent memory. Use this to remember things across sessions.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      note: {
        type: Type.STRING,
        description: "The note to save.",
      },
    },
    required: ["note"],
  },
};

export const assignTaskDeclaration: FunctionDeclaration = {
  name: "assign_task",
  description:
    "Assign a task to another agent in the swarm. The task will be added to the queue and the target agent will pick it up automatically. Use this to delegate work to specialized agents.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      agent: {
        type: Type.STRING,
        description: "The name of the agent to assign the task to (e.g. 'coder', 'writer', 'researcher').",
      },
      task: {
        type: Type.STRING,
        description: "A clear description of what the agent should do.",
      },
    },
    required: ["agent", "task"],
  },
};

export const createProjectDeclaration: FunctionDeclaration = {
  name: "create_project",
  description:
    "Create a project with a task dependency graph. Decomposes a project into subtasks with dependencies between them. Tasks are assigned to specific agents and will execute in dependency order.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      project: {
        type: Type.STRING,
        description: "High-level description of the project.",
      },
      tasks: {
        type: Type.ARRAY,
        description: "Array of subtasks with dependencies.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.STRING,
              description: 'Local reference ID for this task (e.g. "t1", "t2").',
            },
            description: {
              type: Type.STRING,
              description: "What the agent should do.",
            },
            agent: {
              type: Type.STRING,
              description: "Name of the agent to assign this task to.",
            },
            depends_on: {
              type: Type.ARRAY,
              description: 'Local ref IDs this task depends on (e.g. ["t1"]).',
              items: { type: Type.STRING },
            },
          },
          required: ["id", "description", "agent"],
        },
      },
    },
    required: ["project", "tasks"],
  },
};

export const showTasksDeclaration: FunctionDeclaration = {
  name: "show_tasks",
  description:
    "Show the current task board with all tasks, their status, and dependencies.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Registry of all tool declarations keyed by name
const toolRegistry: Record<string, FunctionDeclaration> = {
  bash: bashDeclaration,
  save_note: saveNoteDeclaration,
  assign_task: assignTaskDeclaration,
  create_project: createProjectDeclaration,
  show_tasks: showTasksDeclaration,
};

export const allDeclarations = Object.values(toolRegistry);

/** Return only the declarations for the given tool names. */
export function getDeclarations(toolNames: string[]): FunctionDeclaration[] {
  return toolNames
    .map((name) => toolRegistry[name])
    .filter((d): d is FunctionDeclaration => d !== undefined);
}

// --- Implementations ---

function runBash(command: string): string {
  try {
    const output = execSync(command, {
      timeout: BASH_TIMEOUT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.length > MAX_OUTPUT)
      return output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
    return output || "(no output)";
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    return `Exit code ${err.status ?? 1}\n${stdout}${stderr}`.trim();
  }
}

function saveNote(note: string): string {
  fs.appendFileSync(NOTES_PATH, `- ${note}\n`);
  return "Note saved.";
}

function assignTask(agent: string, task: string): string {
  const available = listAgents();
  if (!available.includes(agent)) {
    return `Unknown agent "${agent}". Available agents: ${available.join(", ")}`;
  }
  const created = enqueue(task, agent);
  return `Task ${created.id} assigned to ${agent}: "${task}"`;
}

function createProject(project: string, tasks: any[]): string {
  const available = listAgents();

  // Validate agents exist
  for (const t of tasks) {
    if (!available.includes(t.agent)) {
      return `Unknown agent "${t.agent}". Available agents: ${available.join(", ")}`;
    }
  }

  // Build local ID set for validation
  const localIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      if (!localIds.has(dep)) {
        return `Task "${t.id}" depends on unknown task "${dep}".`;
      }
    }
  }

  // Simple cycle detection via topological sort
  const inDegree: Record<string, number> = {};
  const graph: Record<string, string[]> = {};
  for (const t of tasks) {
    inDegree[t.id] = (t.depends_on ?? []).length;
    graph[t.id] = [];
  }
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      graph[dep] = graph[dep] ?? [];
      graph[dep].push(t.id);
    }
  }
  const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
  let sorted = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted++;
    for (const neighbor of graph[node] ?? []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }
  if (sorted !== tasks.length) {
    return "Circular dependency detected in task graph.";
  }

  // Create parent task (the project container — marked done immediately)
  const parent = enqueueWithDeps(project, "orchestrator");
  complete(parent.id, "project created");

  // Two-pass: first map local IDs to real IDs
  const idMap: Record<string, number> = {};

  // Pass 1: enqueue tasks with no dependencies
  for (const t of tasks) {
    const deps = t.depends_on ?? [];
    if (deps.length === 0) {
      const created = enqueueWithDeps(t.description, t.agent, { parentId: parent.id });
      idMap[t.id] = created.id;
    }
  }

  // Pass 2: enqueue tasks with dependencies (translate local refs to real IDs)
  for (const t of tasks) {
    const deps = t.depends_on ?? [];
    if (deps.length > 0) {
      const realDeps = deps.map((d: string) => idMap[d]);
      const created = enqueueWithDeps(t.description, t.agent, {
        parentId: parent.id,
        dependsOn: realDeps,
      });
      idMap[t.id] = created.id;
    }
  }

  // Auto-create a final review task for orchestrator — carries full project context
  const allSubtaskIds = Object.values(idMap);
  const taskSummary = tasks.map(t => `  - ${t.agent}: ${t.description}`).join("\n");
  const combineDesc = [
    `Review and deliver: "${project}"`,
    ``,
    `Original request: ${project}`,
    `Subtasks:`,
    taskSummary,
    ``,
    `You are the project manager. Review all subtask results against the original request.`,
    `Assess completeness, quality, and coherence. Flag gaps or issues.`,
    `Deliver a final response as if you are reporting back to the user who asked for this.`,
  ].join("\n");
  const combineTask = enqueueWithDeps(
    combineDesc,
    "orchestrator",
    { parentId: parent.id, dependsOn: allSubtaskIds, replyTo: "user" }
  );

  // Build summary
  const lines = [`Project created (task-${parent.id}): "${project}"`];
  for (const t of tasks) {
    const realId = idMap[t.id];
    const deps = t.depends_on ?? [];
    const depStr = deps.length > 0 ? ` ← depends on [${deps.map((d: string) => idMap[d]).join(", ")}]` : "";
    lines.push(`  task-${realId} (${t.agent}): "${t.description}"${depStr}`);
  }
  lines.push(`  task-${combineTask.id} (orchestrator): "Combine results" ← depends on [${allSubtaskIds.join(", ")}]`);
  return lines.join("\n");
}

/** Render an ASCII task board. */
export function renderTaskBoard(): string {
  const tasks = getAllTasks();
  if (tasks.length === 0) return "No tasks in queue.";

  const lines: string[] = [];
  const statusIcon: Record<string, string> = {
    pending: "pending",
    "in-progress": "in-progress",
    done: "done",
    failed: "FAILED",
    blocked: "blocked",
  };

  const roots = tasks.filter((t) => t.parent_id === null);
  const children = (parentId: number) => tasks.filter((t) => t.parent_id === parentId);

  for (const root of roots) {
    const subs = children(root.id);
    if (subs.length > 0) {
      lines.push(`Project: "${root.description}" (task-${root.id}, ${root.assigned_to})`);
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const isLast = i === subs.length - 1;
        const prefix = isLast ? "└──" : "├──";
        const depStr = sub.depends_on.length > 0 ? ` ← depends on [${sub.depends_on.join(", ")}]` : "";
        lines.push(`${prefix} [${statusIcon[sub.status]}] task-${sub.id} (${sub.assigned_to}): "${sub.description}"${depStr}`);
      }
    } else {
      lines.push(`[${statusIcon[root.status]}] task-${root.id} (${root.assigned_to}): "${root.description}"`);
    }
  }

  const counts: Record<string, number> = { done: 0, "in-progress": 0, pending: 0, blocked: 0, failed: 0 };
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  lines.push("");
  lines.push(`Summary: ${counts.done} done, ${counts["in-progress"]} in-progress, ${counts.pending} pending, ${counts.blocked} blocked, ${counts.failed} failed`);

  return lines.join("\n");
}

function showTasks(): string {
  return renderTaskBoard();
}

export function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    case "assign_task":
      return assignTask(args.agent, args.task);
    case "create_project":
      return createProject(args.project, args.tasks);
    case "show_tasks":
      return showTasks();
    default:
      return `Unknown tool: ${name}`;
  }
}
