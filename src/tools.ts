import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { NOTES_PATH, initMemory } from "./memory.js";
import { listAgents, loadAgentConfig } from "./config.js";
import {
  createTask as createProjectTask,
  updateTask as updateProjectTask,
  getTasks as getProjectTasks,
  appendProjectLog,
  loadProjectLog,
  getRole,
} from "./project.js";

const BASH_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

// --- Project context (set at startup) ---

let activeProject = "";
let activeAgent = "";

export function setProjectContext(project: string, agent: string): void {
  activeProject = project;
  activeAgent = agent;
}

export function getProjectContext(): { project: string; agent: string } {
  return { project: activeProject, agent: activeAgent };
}

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

export const askAgentDeclaration: FunctionDeclaration = {
  name: "ask_agent",
  description:
    "Delegate a task to another agent and get back its result. The other agent will complete the task fully and return its response. Use this when a task is better suited to a specialist.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      agent: {
        type: Type.STRING,
        description: "The name of the agent to delegate to (e.g. 'coder', 'writer', 'researcher').",
      },
      task: {
        type: Type.STRING,
        description: "A clear description of what the agent should do.",
      },
    },
    required: ["agent", "task"],
  },
};

export const createTaskDeclaration: FunctionDeclaration = {
  name: "create_task",
  description:
    "Create a new task on the project task board. Only managers can create tasks.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: "Short title for the task.",
      },
      description: {
        type: Type.STRING,
        description: "Detailed description of what needs to be done.",
      },
      assignee: {
        type: Type.STRING,
        description: "Agent name to assign the task to. Defaults to unassigned.",
      },
    },
    required: ["title", "description"],
  },
};

export const updateTaskDeclaration: FunctionDeclaration = {
  name: "update_task",
  description:
    "Update a task's status or result. Contributors can only update their own tasks.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      task_id: {
        type: Type.STRING,
        description: "The task ID (e.g. 'task-001').",
      },
      status: {
        type: Type.STRING,
        description: "New status: todo, in_progress, done, or blocked.",
      },
      result: {
        type: Type.STRING,
        description: "Result or output of the completed task.",
      },
    },
    required: ["task_id"],
  },
};

export const listTasksDeclaration: FunctionDeclaration = {
  name: "list_tasks",
  description:
    "List tasks from the project task board, optionally filtered by status or assignee.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      status: {
        type: Type.STRING,
        description: "Filter by status: todo, in_progress, done, or blocked.",
      },
      assignee: {
        type: Type.STRING,
        description: "Filter by assignee agent name.",
      },
    },
  },
};

export const projectLogDeclaration: FunctionDeclaration = {
  name: "project_log",
  description:
    "Read or write to the shared project log. Use this to share findings, decisions, or context with the whole team.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: "Either 'read' to view the log or 'write' to append an entry.",
      },
      entry: {
        type: Type.STRING,
        description: "The log entry to write (required when action is 'write').",
      },
    },
    required: ["action"],
  },
};

// Registry of all tool declarations keyed by name
const toolRegistry: Record<string, FunctionDeclaration> = {
  bash: bashDeclaration,
  save_note: saveNoteDeclaration,
  ask_agent: askAgentDeclaration,
  create_task: createTaskDeclaration,
  update_task: updateTaskDeclaration,
  list_tasks: listTasksDeclaration,
  project_log: projectLogDeclaration,
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

async function askAgent(agentName: string, task: string): Promise<string> {
  // Prevent self-delegation (infinite loop)
  if (agentName === activeAgent) {
    return `Cannot delegate to yourself. Use your own tools to complete the task directly.`;
  }

  // Permission check: in a project, only managers can delegate
  if (activeProject) {
    const role = getRole(activeProject, activeAgent);
    if (role !== "manager") {
      return `Permission denied: only managers can delegate tasks via ask_agent. Your role: ${role}`;
    }
  }

  const available = listAgents();
  if (!available.includes(agentName)) {
    return `Unknown agent "${agentName}". Available agents: ${available.join(", ")}`;
  }

  const { Agent } = await import("./agent.js");

  // Save parent context and set child context
  const parentAgent = activeAgent;
  activeAgent = agentName;

  const config = loadAgentConfig(agentName);
  initMemory(config);
  const agent = new Agent(config, activeProject || undefined);
  const result = await agent.run(task);

  // Restore parent context
  activeAgent = parentAgent;
  return result;
}

function handleCreateTask(args: Record<string, any>): string {
  if (!activeProject) return "No active project. Start with PROJECT=<name> to use project tools.";
  const role = getRole(activeProject, activeAgent);
  if (role !== "manager") return `Permission denied: only managers can create tasks. Your role: ${role}`;

  const task = createProjectTask(activeProject, {
    title: args.title,
    description: args.description,
    assignee: args.assignee || "",
    createdBy: activeAgent,
  });
  appendProjectLog(activeProject, `[${activeAgent}] Created ${task.id}: "${task.title}" → ${task.assignee || "unassigned"}`);
  return JSON.stringify(task, null, 2);
}

function handleUpdateTask(args: Record<string, any>): string {
  if (!activeProject) return "No active project. Start with PROJECT=<name> to use project tools.";
  const role = getRole(activeProject, activeAgent);

  // Contributors can only update their own tasks
  if (role === "contributor") {
    const tasks = getProjectTasks(activeProject);
    const task = tasks.find((t) => t.id === args.task_id);
    if (!task) return `Task not found: ${args.task_id}`;
    if (task.assignee !== activeAgent) {
      return `Permission denied: contributors can only update their own tasks. Task "${args.task_id}" is assigned to "${task.assignee}".`;
    }
  }

  const updated = updateProjectTask(activeProject, args.task_id, {
    status: args.status,
    result: args.result,
  });
  if (!updated) return `Task not found: ${args.task_id}`;
  appendProjectLog(activeProject, `[${activeAgent}] Updated ${updated.id}: status=${updated.status}`);
  return JSON.stringify(updated, null, 2);
}

function handleListTasks(args: Record<string, any>): string {
  if (!activeProject) return "No active project. Start with PROJECT=<name> to use project tools.";
  const tasks = getProjectTasks(activeProject, {
    status: args.status,
    assignee: args.assignee,
  });
  if (tasks.length === 0) return "No tasks found.";
  return JSON.stringify(tasks, null, 2);
}

function handleProjectLog(args: Record<string, any>): string {
  if (!activeProject) return "No active project. Start with PROJECT=<name> to use project tools.";
  if (args.action === "write") {
    if (!args.entry) return "Missing 'entry' parameter for write action.";
    appendProjectLog(activeProject, `[${activeAgent}] ${args.entry}`);
    return "Log entry added.";
  }
  return loadProjectLog(activeProject);
}

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    case "ask_agent":
      return askAgent(args.agent, args.task);
    case "create_task":
      return handleCreateTask(args);
    case "update_task":
      return handleUpdateTask(args);
    case "list_tasks":
      return handleListTasks(args);
    case "project_log":
      return handleProjectLog(args);
    default:
      return `Unknown tool: ${name}`;
  }
}
