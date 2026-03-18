import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { NOTES_PATH, initMemory } from "./memory.js";
import { listAgents, loadAgentConfig } from "./config.js";
import {
  postTask,
  listTasks,
  updateTask,
  readArtifact,
  writeArtifact,
} from "./workspace.js";

const BASH_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

// --- Active agent tracking ---

let activeAgent = "";

export function setActiveAgent(agent: string): void {
  activeAgent = agent;
}

export function getActiveAgent(): string {
  return activeAgent;
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

export const postTaskDeclaration: FunctionDeclaration = {
  name: "post_task",
  description:
    "Post a task to the global workspace. Any agent can later see it and claim it. Use blocked_by to express dependencies — the task won't be claimable until all listed task IDs are done.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: "A clear, actionable description of what needs to be done.",
      },
      blocked_by: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Task IDs this task depends on (e.g. ['task-001']). Optional.",
      },
    },
    required: ["title"],
  },
};

export const listTasksDeclaration: FunctionDeclaration = {
  name: "list_tasks",
  description:
    "List tasks from the global workspace. See what work is available, in progress, or done.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      status: {
        type: Type.STRING,
        description: "Filter by status: 'open', 'in_progress', or 'done'. Omit to see all.",
      },
    },
  },
};

export const updateTaskDeclaration: FunctionDeclaration = {
  name: "update_task",
  description:
    "Claim or complete a task in the global workspace. Claim an open task to start working on it. Complete a task when done, with a result summary.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      task_id: {
        type: Type.STRING,
        description: "The task ID (e.g. 'task-001').",
      },
      action: {
        type: Type.STRING,
        description: "'claim' to start working on it, or 'complete' to mark it done.",
      },
      result: {
        type: Type.STRING,
        description: "Result summary (required when completing).",
      },
    },
    required: ["task_id", "action"],
  },
};

export const readArtifactDeclaration: FunctionDeclaration = {
  name: "read_artifact",
  description:
    "Read a shared artifact from the global workspace by key, or list all artifacts. Artifacts are data that agents leave for each other — research findings, analysis, drafts, etc.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      key: {
        type: Type.STRING,
        description: "The artifact key to read. Omit to list all.",
      },
    },
  },
};

export const writeArtifactDeclaration: FunctionDeclaration = {
  name: "write_artifact",
  description:
    "Write a shared artifact to the global workspace under a key. Other agents can read it later. Use this to share findings, research, analysis, or drafts.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      key: {
        type: Type.STRING,
        description: "A descriptive key (e.g. 'codebase-analysis', 'api-docs-draft').",
      },
      value: {
        type: Type.STRING,
        description: "The content to store.",
      },
    },
    required: ["key", "value"],
  },
};

// Registry of all tool declarations keyed by name
const toolRegistry: Record<string, FunctionDeclaration> = {
  bash: bashDeclaration,
  save_note: saveNoteDeclaration,
  ask_agent: askAgentDeclaration,
  post_task: postTaskDeclaration,
  list_tasks: listTasksDeclaration,
  update_task: updateTaskDeclaration,
  read_artifact: readArtifactDeclaration,
  write_artifact: writeArtifactDeclaration,
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
  const agent = new Agent(config);
  const result = await agent.run(task);

  // Restore parent context
  activeAgent = parentAgent;
  return result;
}

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    case "ask_agent":
      return askAgent(args.agent, args.task);
    case "post_task":
      return postTask(args.title, activeAgent, args.blocked_by);
    case "list_tasks":
      return listTasks(args.status);
    case "update_task":
      return updateTask(args.task_id, activeAgent, args.action, args.result);
    case "read_artifact":
      return readArtifact(args.key);
    case "write_artifact":
      return writeArtifact(args.key, args.value, activeAgent);
    default:
      return `Unknown tool: ${name}`;
  }
}
