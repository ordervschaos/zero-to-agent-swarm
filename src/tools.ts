import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { NOTES_PATH } from "./memory.js";
import { enqueue } from "./task-queue.js";
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

// Registry of all tool declarations keyed by name
const toolRegistry: Record<string, FunctionDeclaration> = {
  bash: bashDeclaration,
  save_note: saveNoteDeclaration,
  assign_task: assignTaskDeclaration,
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

export function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    case "assign_task":
      return assignTask(args.agent, args.task);
    default:
      return `Unknown tool: ${name}`;
  }
}
