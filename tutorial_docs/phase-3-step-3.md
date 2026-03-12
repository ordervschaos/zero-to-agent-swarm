# Phase 3, Step 3 — Task Delegation: Agents Assign Tasks to Each Other

## What you'll learn

- How to give agents the ability to **delegate work** to other agents
- How the task queue becomes a **communication channel**, not just a to-do list
- How **roster awareness** lets agents make intelligent delegation decisions
- Why lateral communication is the foundation of a self-organizing swarm

## The Big Idea

Until now, work flows in one direction: user → task queue → agents. Agents are workers — they pull tasks and execute them, but they can't create work for each other. That's a bottleneck. If a coder agent realizes it needs documentation, it has to finish and hope the user notices. If a researcher finds something that needs coding, same problem.

The fix is simple: give agents the same power the user has — the ability to enqueue tasks for other agents.

```
Before:  User → Queue → Agent (dead end)
After:   User → Queue → Agent → Queue → Agent → Queue → Agent ...
```

This turns the task queue from a to-do list into a **message passing system**. Agents can now trigger each other, creating chains of work that flow through the swarm without user intervention.

## Step 1 — The `assign_task` Tool

We add a new tool that any agent can call:

```typescript
// src/tools.ts
export const assignTaskDeclaration: FunctionDeclaration = {
  name: "assign_task",
  description:
    "Assign a task to another agent in the swarm. The task will be added to the queue and the target agent will pick it up automatically.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      agent: {
        type: Type.STRING,
        description: "The name of the agent to assign the task to.",
      },
      task: {
        type: Type.STRING,
        description: "A clear description of what the agent should do.",
      },
    },
    required: ["agent", "task"],
  },
};
```

The implementation validates the target agent exists and enqueues the task:

```typescript
function assignTask(agent: string, task: string): string {
  const available = listAgents();
  if (!available.includes(agent)) {
    return `Unknown agent "${agent}". Available agents: ${available.join(", ")}`;
  }
  const created = enqueue(task, agent);
  return `Task ${created.id} assigned to ${agent}: "${task}"`;
}
```

Two important design decisions here:

1. **Validation** — the tool checks that the target agent actually exists. Without this, a hallucinating LLM could assign tasks to imaginary agents, and those tasks would sit in the queue forever.

2. **Confirmation** — the tool returns the task ID, giving the originating agent proof that the delegation happened. This could later be used for tracking and follow-up.

## Step 2 — Roster Awareness

An agent can't delegate intelligently if it doesn't know who else is in the swarm. We inject a **roster** — a list of peer agents and their descriptions — into the system instruction:

```typescript
// src/agent.ts
private buildSwarmRoster(): string {
  const agents = listAgents();
  const lines = agents
    .filter((name) => name !== this.config.name)  // exclude self
    .map((name) => {
      const cfg = loadAgentConfig(name);
      return `  - ${name}: ${cfg.description}`;
    });
  if (lines.length === 0) return "";
  return `\n\nYou are part of an agent swarm. You can delegate tasks to other agents using the assign_task tool.\nAvailable agents:\n${lines.join("\n")}`;
}
```

This means the coder agent sees:
```
You are part of an agent swarm. You can delegate tasks to other agents using the assign_task tool.
Available agents:
  - writer: Writing agent — creates docs, summaries, and text content
  - researcher: Research agent that gathers and organizes information
  - default: General-purpose assistant agent
```

Notice we **exclude self** from the roster. An agent assigning tasks to itself would create an infinite loop through the queue — possible to handle, but unnecessary complexity at this stage.

## Step 3 — Enable It Everywhere

Every agent genome gets `assign_task` added to its tool list:

```json
{
  "name": "coder",
  "tools": ["bash", "save_note", "assign_task"],
  ...
}
```

This is a deliberate choice — every agent can delegate. In a more controlled system, you might restrict delegation to certain agents (a "lead" agent that coordinates, while workers just execute). But for now, a flat hierarchy where anyone can delegate is simpler and more flexible.

## Try it

```bash
SWARM_AGENTS=coder,writer,researcher npm run dev
```

Then give one agent a task that naturally involves another:

```
you: coder: build a Python calculator with add, subtract, multiply, divide — then get someone to write the docs
```

Watch what happens:
1. The coder agent picks up the task
2. It writes the Python calculator using bash
3. It calls `assign_task(agent: "writer", task: "Write documentation for the Python calculator...")`
4. The writer agent picks up the delegated task on its next poll
5. The writer creates the documentation

```
[coder] picked up task-1: "build a Python calculator..."
[coder] [tool: bash({command: "cat > calculator.py ..."})]
[coder] [tool: assign_task({agent: "writer", task: "Write docs for calculator.py..."})]
  [queue] added task-2 → writer: "Write docs for calculator.py..."
coder: Done — wrote calculator.py and assigned documentation to the writer agent.
[writer] picked up task-2: "Write docs for calculator.py..."
[writer] [tool: bash({command: "cat > CALCULATOR_README.md ..."})]
writer: Documentation complete.
```

## What's really happening

```
you: "coder: build calculator + get docs written"
  ↓
[queue] task-1 → coder
  ↓
[coder] claims task-1
  ├── bash: writes calculator.py
  └── assign_task: creates task-2 → writer
  ↓
[queue] task-2 → writer
  ↓
[writer] claims task-2
  └── bash: writes README.md
  ↓
Both tasks complete — no user intervention needed
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Task delegation** | Agents communicate by creating tasks for each other |
| **Delegation** | An agent can break down its work and hand off parts |
| **Roster awareness** | Each agent knows who else exists and what they do |
| **Lateral communication** | Agents talk to peers, not just back to the user |
| **Emergent workflows** | Work chains form from agent decisions, not hardcoded pipelines |

## Design considerations

**Why use the task queue for messaging?** We already have it. Adding a separate message bus would add complexity without new capability at this stage. The task queue gives us everything we need: delivery, persistence, and ordered processing.

**Why not let agents assign tasks to themselves?** The roster excludes self to avoid loops. An agent could still technically assign to itself by name, but without it appearing in the roster, the LLM won't naturally try. If you need self-delegation (e.g., "remind me to check this later"), you'd add it explicitly.

**What about task chains and dependencies?** Right now, tasks are independent — the writer doesn't know it's working on something the coder created. Adding a `parent_task_id` field to the task schema would enable dependency tracking, progress rollup, and eventual DAG-based orchestration. That's a natural next step.

## What's missing (and what's next)

- Agents can create tasks but can't check results — next: **status queries** (`check_task` tool)
- No dependency tracking between parent and child tasks — next: **task DAGs**
- No coordination beyond delegation — next: **orchestrator agent** that plans and monitors
- Agents don't share context — next: **shared blackboard** for inter-agent state

---

**Next**: Phase 3, Step 4 — Orchestration: a meta-agent that decomposes, delegates, and monitors.
