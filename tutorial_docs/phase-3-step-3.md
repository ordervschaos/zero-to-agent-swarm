# Phase 3, Step 3 — Project Mode: Shared Context, Shared Goals

## What you'll learn

- How to give a team of agents a **shared project**: goal, roles, task board, and log
- How **role-based permissions** control what each agent can do
- How the manager drives the work — and why without one, it's chaos
- How project context flows into every agent's system prompt automatically

## The Big Idea

In step 2, delegation worked for one-off handoffs: the coder finishes its task, delegates docs to the writer, delivers. Clean and simple.

But what if the work is bigger? A feature build. A content campaign. A research brief that spans days. One-off delegation doesn't hold shape across that — there's no shared goal, no task board, no record of what's been done or what's next. Every agent wakes up blind.

That's what a **project** solves. A project is a shared context that lives on disk and gets injected into every agent's system prompt:

- **Goal** — what the team is working toward
- **Role** — what this specific agent is responsible for
- **Task board** — what needs to happen, what's in progress, what's done
- **Log** — a running record of decisions and handoffs

Every agent on the team reads from the same source of truth. The manager creates tasks, delegates them, and drives toward the goal. Contributors pick up tasks, do the work, and report back.

## Why you need a manager

Before building the tools, a story: I first tried running a project with just a coder and a writer, no manager. Both agents were capable. Neither knew what came next. They'd each complete one task and stop. Nothing drove the work forward.

The manager's job is exactly that: look at the goal, create tasks, assign them, push them through to done. Without a manager, a team of capable agents produces nothing coherent.

## The project config

A project lives in `projects/<name>.json`:

```json
{
  "name": "website-redesign",
  "description": "Redesign the company landing page",
  "goal": "Create a modern, responsive landing page with new copy and clean CSS",
  "team": {
    "default": "manager",
    "coder": "contributor",
    "writer": "contributor",
    "researcher": "contributor"
  }
}
```

The team map is the authority on who's on the project and what role they play. It's the only place roles are defined.

## Step 1 — Project state: `src/project.ts`

A new module owns all project I/O. It reads configs, manages the task board, and reads/writes the project log — all as plain files on disk.

```typescript
export interface Task {
  id: string;           // "task-001"
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  assignee: string;     // agent name
  createdBy: string;
  result: string;
}
```

Tasks persist in `projects/<name>/tasks.json`. The log lives in `projects/<name>/log.md`. Both are created on first run via `initProject()`.

The module also exposes `getRole(project, agent)` — the single source of truth for permission checks. Every tool that needs to know "can this agent do this?" calls it.

## Step 2 — Four new tools

We add four tools for project coordination:

| Tool | Who can use it | What it does |
|------|---------------|--------------|
| `list_tasks` | anyone | Read task board, filter by status or assignee |
| `project_log` | anyone (write) | Append an entry to the shared log; or read the full log |
| `create_task` | managers only | Add a new task to the board |
| `update_task` | contributors (own tasks only), managers (any task) | Change status or record a result |

The permission checks are in the tool handlers, not the agent:

```typescript
function handleCreateTask(args): string {
  const role = getRole(activeProject, activeAgent);
  if (role !== "manager") return `Permission denied: only managers can create tasks.`;
  // ...
}

function handleUpdateTask(args): string {
  if (role === "contributor") {
    const task = tasks.find(t => t.id === args.task_id);
    if (task.assignee !== activeAgent) {
      return `Permission denied: contributors can only update their own tasks.`;
    }
  }
  // ...
}
```

Contributors can only move their own tasks forward. Managers have full authority. The LLM doesn't enforce this — the code does.

## Step 3 — Project context in the system prompt

Every agent gets the project context prepended to its system prompt when it starts:

```typescript
private buildProjectContext(): string {
  if (!this.project) return "";
  const config = loadProjectConfig(this.project);
  const role = getRole(this.project, this.config.name);
  const log = loadProjectLog(this.project);

  return `\n\n## Active Project: ${config.name}\nGoal: ${config.goal}\nYour role: ${role}\n\n## Project Log\n${log}`;
}

private async loop(): Promise<string> {
  const systemInstruction =
    loadMemory(this.config.name) +
    this.buildProjectContext() +      // ← injected here
    this.buildSwarmRoster();
  // ...
}
```

The agent sees the goal, its role, and the full project log before it does anything. No extra prompting needed — the context is just there.

In project mode, the roster also changes: instead of showing all available agents, it shows only team members — with their roles:

```
Team members:
  - coder (contributor): Coding specialist — writes and runs code
  - writer (contributor): Writing agent — creates docs, copy, and text content
  - researcher (contributor): Research agent — gathers and organizes information
```

## Step 4 — Project context in tools

Tools need to know which project and agent they're operating in. We add module-level state to `tools.ts`:

```typescript
let activeProject = "";
let activeAgent = "";

export function setProjectContext(project: string, agent: string): void {
  activeProject = project;
  activeAgent = agent;
}
```

`index.ts` calls `setProjectContext()` at startup. When `ask_agent` spawns a child agent, it temporarily swaps the context, runs the child, then restores:

```typescript
const parentAgent = activeAgent;
activeAgent = agentName;
// ... run child agent ...
activeAgent = parentAgent;
```

This means each agent's tool calls always reflect the correct identity and project — including the permission checks.

We also add two guards to `ask_agent` in project mode:

1. **Self-delegation guard** — prevents infinite loops if an agent tries to delegate to itself
2. **Manager-only delegation** — in project mode, only managers can call `ask_agent`

## Step 5 — Starting a project

`index.ts` reads the `PROJECT` env var:

```typescript
const projectName = process.env.PROJECT || "";

if (projectName) {
  const projectConfig = loadProjectConfig(projectName);

  // Default to the project's manager if no agent specified
  if (!explicitAgentName) {
    const managerEntry = Object.entries(projectConfig.team)
      .find(([, role]) => role === "manager");
    if (managerEntry) agentName = managerEntry[0];
  }

  // Reject agents not on the team
  const role = projectConfig.team[agentName];
  if (!role) {
    console.error(`Agent "${agentName}" is not on the team.`);
    process.exit(1);
  }

  initProject(projectConfig);
  setProjectContext(projectName, agentName);
  appendProjectLog(projectName, `[${agentName}] joined as ${role}`);
  project = projectName;
}
```

Starting with `PROJECT=website-redesign` defaults to the manager. Starting with `PROJECT=website-redesign AGENT_NAME=coder` starts a contributor directly.

## Step 6 — The manager genome

```json
{
  "name": "manager",
  "description": "Project manager agent that drives tasks forward",
  "identity": "You are a project manager. Your primary job is to drive the project forward by actively managing tasks. On every interaction: (1) check the task list with list_tasks, (2) move tasks through their lifecycle — assign todo tasks, mark in-progress tasks done when complete, unblock blocked tasks, (3) delegate work to specialist agents using ask_agent when needed, (4) create new tasks if the project goal requires more work. Never idle — always find the next thing to push forward. Log significant decisions to the project log.",
  "tools": ["bash", "save_note", "ask_agent", "create_task", "update_task", "list_tasks", "project_log"],
  "triggers": { "repl": true, "fileWatcher": true, "clock": true }
}
```

The manager has everything: task tools, delegation, bash. The identity is explicit about what to do on every iteration — check the board, push tasks forward, never idle. This is important: without a clear directive, the manager will just respond to the user instead of driving the work.

## Try it

```bash
PROJECT=website-redesign npm start
```

You'll see the project banner at startup:

```
■ Project: website-redesign
  Goal: Create a modern, responsive landing page with new copy and clean CSS
  Role: manager
  Team: default(manager)  coder(contributor)  writer(contributor)  researcher(contributor)

▶ Agent: default — general-purpose assistant agent
```

Then give the manager a nudge:

```
you: start the project
```

Watch it:
1. Call `list_tasks` — empty board
2. Call `create_task` for each piece of work — research, copy, HTML, CSS
3. Call `ask_agent("researcher", ...)` — researcher runs, returns findings
4. Call `ask_agent("writer", ...)` — writer drafts copy
5. Mark tasks done as results come in
6. Log decisions to the project log

You can also start a contributor directly:

```bash
PROJECT=website-redesign AGENT_NAME=coder npm start
```

The coder will see its assigned tasks and can only update its own.

## What's on disk after a run

```
projects/
└── website-redesign/
    ├── tasks.json    ← task board (created/updated by manager)
    └── log.md        ← project log (appended by any agent)
```

The project state survives process restarts. Start the manager again and it picks up where it left off — `list_tasks` shows in-progress and done work alongside what's still todo.

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Project as shared context** | Goal, role, log injected into every agent's system prompt |
| **Role-based permissions** | Code enforces what each role can do — the LLM doesn't |
| **Manager as driver** | Without explicit driving, agents complete one task and stop |
| **Task board as coordination** | Agents coordinate through shared state, not direct messages |
| **Context swap for delegation** | Child agents inherit project context; parent context restores after |

## Design considerations

**Why file-based state?** Tasks and logs are plain JSON and Markdown. They're readable, debuggable, and survive restarts. For a production system you'd use a database — but the logic is identical, just a different storage layer.

**Why permission checks in the tool handlers?** The LLM will follow instructions, but it can also misunderstand them or be convinced otherwise. Enforcing permissions in code means a contributor can never accidentally (or intentionally) create tasks or delegate work, regardless of how it's prompted.

**Why does the manager need an explicit "never idle" directive?** Without it, the manager acts like a regular assistant — it responds to what the user said and waits for the next message. The directive changes its default: always look at the board and push the next thing forward. That's what makes it a manager instead of a chatbot.

**Why does delegation require manager role?** A contributor completing a task shouldn't be spinning up other agents. That's scope creep — and in a real system, it could cascade into uncontrolled work. Managers own the work plan; contributors execute their piece.

## What's missing (and what's next)

- Agents still run one at a time — the manager delegates sequentially, not in parallel
- The project log is append-only and unstructured — no way to query it semantically
- There's no notification when a task is done — the manager has to poll

**Next**: Phase 3, Step 4 — missions: long-running, open-ended work that persists across sessions and adapts over time.
