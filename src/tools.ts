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
  postDagTask,
  getProjectStatus,
} from "./workspace.js";
import { executeDag, flattenTaskTree } from "./dag.js";
import type { DagNode, DagPlan, TaskTree } from "./dag.js";

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
    "Save a private note to YOUR OWN memory. Only you can see these notes — other agents cannot read them. Use this ONLY for personal reminders, preferences, or things you want to remember across sessions. Do NOT use this to share results with other agents — use write_artifact for that.",
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
    "Post a task to the global workspace. Any agent can later see it and claim it. Use this to break work into pieces that specialists can pick up.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: "A clear, actionable description of what needs to be done.",
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
    "Write a shared artifact to the global workspace under a key. ALL other agents can read it. This is the PRIMARY way to share results, findings, research, analysis, or any output that other agents need. Always use this instead of save_note when your work will be consumed by others.",
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

export const runProjectDeclaration: FunctionDeclaration = {
  name: "run_project",
  description:
    "Plan and execute a project as a tree of tasks. Structure tasks hierarchically:\n" +
    "- Sequential siblings (set sequential: true): an ordered list — each task is blocked by the previous one.\n" +
    "- Parallel siblings (sequential: false or omitted): all run at the same time.\n" +
    "- Nested subtasks: the parent task completes only when ALL subtasks finish.\n" +
    "Leaf tasks (no subtasks) are delegated to specialist agents. Container tasks (with subtasks) are grouping nodes that auto-complete.\n" +
    "Context from completed tasks is automatically passed to dependent tasks.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      goal: {
        type: Type.STRING,
        description: "The overall project goal or objective.",
      },
      sequential: {
        type: Type.BOOLEAN,
        description:
          "If true (default), top-level tasks run one after another in order. Set to false only when ALL top-level tasks are truly independent and can run in parallel.",
      },
      tasks: {
        type: Type.ARRAY,
        description:
          "The task tree. Each task can optionally have subtasks (making it a container). Use sequential: true on containers for ordered execution, omit for parallel.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.STRING,
              description:
                "Short unique slug (e.g. 'research', 'implement', 'write-docs').",
            },
            title: {
              type: Type.STRING,
              description: "Clear, actionable description of what this task entails.",
            },
            agent: {
              type: Type.STRING,
              description:
                "Specialist to delegate to: 'researcher', 'coder', 'writer'. For container tasks, set to the agent that best represents the group.",
            },
            subtasks: {
              type: Type.ARRAY,
              description:
                "Child tasks. If present, this becomes a container that auto-completes when all children finish.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique slug for this subtask." },
                  title: { type: Type.STRING, description: "Description of the subtask." },
                  agent: { type: Type.STRING, description: "Specialist agent." },
                },
                required: ["id", "title", "agent"],
              },
            },
            sequential: {
              type: Type.BOOLEAN,
              description:
                "If true, subtasks run in order (each blocked by previous). If false/omitted, subtasks run in parallel. Use true when subtasks have a natural ordering.",
            },
          },
          required: ["id", "title", "agent"],
        },
      },
    },
    required: ["goal", "tasks"],
  },
};

export const weatherDeclaration: FunctionDeclaration = {
  name: "weather",
  description:
    "Get current weather and forecast for a location. Returns temperature, conditions, wind, humidity, and a 3-day forecast.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description:
          "City name, zip code, or location (e.g. 'London', 'New York', '90210', 'Paris,France').",
      },
    },
    required: ["location"],
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
  run_project: runProjectDeclaration,
  weather: weatherDeclaration,
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

async function getWeather(location: string): Promise<string> {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const res = await fetch(url);
    if (!res.ok) return `Weather API error: ${res.status} ${res.statusText}`;
    const data = await res.json() as any;

    const cur = data.current_condition?.[0];
    if (!cur) return `No weather data found for "${location}".`;

    const lines = [
      `Weather for ${data.nearest_area?.[0]?.areaName?.[0]?.value ?? location}:`,
      `  ${cur.weatherDesc?.[0]?.value ?? "Unknown"}`,
      `  Temperature: ${cur.temp_C}°C / ${cur.temp_F}°F`,
      `  Feels like: ${cur.FeelsLikeC}°C / ${cur.FeelsLikeF}°F`,
      `  Humidity: ${cur.humidity}%`,
      `  Wind: ${cur.windspeedKmph} km/h ${cur.winddir16Point}`,
    ];

    const forecast = data.weather?.slice(0, 3);
    if (forecast?.length) {
      lines.push("", "Forecast:");
      for (const day of forecast) {
        const desc = day.hourly?.[4]?.weatherDesc?.[0]?.value ?? "";
        lines.push(`  ${day.date}: ${day.mintempC}–${day.maxtempC}°C, ${desc}`);
      }
    }

    return lines.join("\n");
  } catch (err: any) {
    return `Weather lookup failed: ${err.message}`;
  }
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
  initMemory(config.name);
  const agent = new Agent(config);
  const result = await agent.run(task);

  // Restore parent context
  activeAgent = parentAgent;
  return result;
}

async function runProject(
  goal: string,
  rawTasks: TaskTree[],
  sequential: boolean = true
): Promise<string> {
  const projectId = `proj-${Date.now()}`;

  // Flatten the task tree into a flat DAG with computed dependsOn
  const flatNodes = flattenTaskTree(rawTasks, sequential, [], undefined, projectId);

  // Register all tasks in workspace for visibility before execution starts
  for (const node of flatNodes) {
    postDagTask(node.id, node.title, node.dependsOn, projectId, activeAgent, {
      parentId: node.parentId,
      isContainer: node.isContainer,
      siblingSequential: node.siblingSequential,
      siblingIndex: node.siblingIndex,
    });
  }

  const plan: DagPlan = {
    projectId,
    goal,
    nodes: flatNodes,
  };

  let results: Map<string, string>;
  try {
    results = await executeDag(plan, async (node: DagNode, priorResults: Map<string, string>) => {
      // Mark in_progress with the specialist as assignee
      updateTask(node.id, node.agent || activeAgent, "claim");

      // Build context from completed dependencies
      const depContext = node.dependsOn
        .filter((dep) => priorResults.has(dep))
        .map((dep) => {
          const depNode = plan.nodes.find((n) => n.id === dep)!;
          return `[${depNode.title}]:\n${priorResults.get(dep)}`;
        })
        .join("\n\n");

      const taskPrompt = depContext
        ? `${node.title}\n\nContext from completed prerequisites:\n${depContext}`
        : node.title;

      const result = await askAgent(node.agent, taskPrompt);

      // Mark done with the specialist as assignee
      updateTask(node.id, node.agent, "complete", result.slice(0, 500));

      return result;
    }, (containerNode) => {
      // Auto-mark container tasks as done in workspace
      updateTask(containerNode.id, activeAgent, "claim");
      updateTask(containerNode.id, activeAgent, "complete", "(all subtasks done)");
    });
  } catch (err: any) {
    return `Project "${goal}" failed: ${err.message}\n\n${getProjectStatus(projectId)}`;
  }

  const summary = plan.nodes
    .filter((n) => !n.isContainer)
    .map((n) => `### ${n.title} (${n.agent})\n${results.get(n.id) ?? ""}`)
    .join("\n\n");

  return `Project complete: "${goal}"\n\n${summary}`;
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
      return postTask(args.title, activeAgent);
    case "list_tasks":
      return listTasks(args.status);
    case "update_task":
      return updateTask(args.task_id, activeAgent, args.action, args.result);
    case "read_artifact":
      return readArtifact(args.key);
    case "write_artifact":
      return writeArtifact(args.key, args.value, activeAgent);
    case "run_project":
      return runProject(args.goal, args.tasks, args.sequential ?? true);
    case "weather":
      return getWeather(args.location);
    default:
      return `Unknown tool: ${name}`;
  }
}
