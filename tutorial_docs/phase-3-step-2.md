# Phase 3, Step 2 — Delegation: Agents As Tools

## What you'll learn

- How one agent can **call another agent like a tool** — delegate a task, wait for the result
- How the calling agent **stays in control** — it owns the final delivery
- How a **roster** gives agents awareness of who they can delegate to
- Why this is the simplest possible multi-agent coordination

## The Big Idea

In step 1 we made agents configurable — same code, different genomes. But each agent still works alone. If the coder needs documentation, it has to write it itself (badly). If the researcher finds something that needs coding, it's stuck.

The fix: let agents call each other like tools. Agent A calls `ask_agent("writer", "write docs for this calculator")`. The writer agent spins up, does its work, and returns the result. Agent A sees it as a tool response — just like `bash` or `save_note` — and continues.

```
Before:  User → Agent (does everything alone)
After:   User → Agent A → ask_agent("writer", task) → Agent B runs → result returns → Agent A continues
```

This is the simplest delegation model: synchronous, single-owner. The calling agent waits for the result and decides what to do with it. No queue, no polling, no coordination layer — just a function call.

## Step 1 — The `ask_agent` tool

We add a new tool that any agent can call:

```typescript
export const askAgentDeclaration: FunctionDeclaration = {
  name: "ask_agent",
  description:
    "Delegate a task to another agent and get back its result. The other agent will complete the task fully and return its response.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      agent: { type: Type.STRING, description: "The agent to delegate to." },
      task: { type: Type.STRING, description: "What the agent should do." },
    },
    required: ["agent", "task"],
  },
};
```

The implementation creates a fresh agent instance and runs it inline:

```typescript
async function askAgent(agentName: string, task: string): Promise<string> {
  const available = listAgents();
  if (!available.includes(agentName)) {
    return `Unknown agent "${agentName}". Available: ${available.join(", ")}`;
  }

  const { Agent } = await import("./agent.js");  // lazy to avoid circular import
  const config = loadAgentConfig(agentName);
  initMemory(config);
  const agent = new Agent(config);
  return agent.run(task);
}
```

Three key decisions:

1. **Fresh instance** — the delegated agent starts with a clean history. It doesn't inherit the caller's context. This keeps agents focused on their specific task.

2. **Lazy import** — `tools.ts` imports from `agent.ts`, and `agent.ts` imports from `tools.ts`. We break the circular dependency with a dynamic `import()` inside the function.

3. **Synchronous from the caller's perspective** — the calling agent's loop pauses while the delegated agent runs. The result comes back as a tool response, and the caller continues its loop.

## Step 2 — Making the loop return results

Previously, `loop()` returned `void` — it printed to the console and stopped. Now it returns `string` — the agent's final text response. This is what the caller receives from `ask_agent`:

```typescript
private async loop(): Promise<string> {
  // ... agent loop ...
  const text = response.text ?? "";
  return text;  // ← returned to caller, not just printed
}
```

We also add a `run()` method — a simpler entry point than `act()` for inline invocation:

```typescript
async run(request: string): Promise<string> {
  this.history.push({ role: "user", parts: [{ text: request }] });
  return this.loop();
}
```

## Step 3 — Roster awareness

An agent needs to know who it can delegate to. We inject a **roster** into the system instruction:

```typescript
private buildSwarmRoster(): string {
  const agents = listAgents();
  const lines = agents
    .filter((name) => name !== this.config.name)  // exclude self
    .map((name) => {
      const cfg = loadAgentConfig(name);
      return `  - ${name}: ${cfg.description}`;
    });
  if (lines.length === 0) return "";
  return `\n\nYou can delegate tasks to other agents using the ask_agent tool.\nAvailable agents:\n${lines.join("\n")}`;
}
```

The coder sees:
```
You can delegate tasks to other agents using the ask_agent tool.
Available agents:
  - writer: Writing agent — creates docs, summaries, and text content
  - researcher: Research agent that gathers and organizes information
  - default: General-purpose assistant agent
```

We **exclude self** — an agent delegating to itself would create infinite recursion.

## Step 4 — Async tools

Because `ask_agent` runs another agent's loop (which calls the LLM), it's async. We make `executeTool` return `Promise<string>`:

```typescript
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "bash":       return runBash(args.command);
    case "save_note":  return saveNote(args.note);
    case "ask_agent":  return askAgent(args.agent, args.task);
    default:           return `Unknown tool: ${name}`;
  }
}
```

Synchronous tools like `bash` still work — they just return resolved promises.

## Try it

```bash
AGENT_NAME=coder npm run start
```

Give it a task that naturally involves another agent:

```
you: Build a Python calculator with add, subtract, multiply, divide — then get someone to write the docs
```

Watch what happens:

```
[coder] [trigger: repl]
[coder] [tool: bash({command: "cat > calculator.py ..."})]
[coder] [tool: ask_agent({agent: "writer", task: "Write docs for calculator.py..."})]

  [writer] [delegated task]
  [writer] [tool: bash({command: "cat > README.md ..."})]
  writer: Documentation complete. Created README.md with usage examples.

coder: Done! I built calculator.py and delegated documentation to the writer agent. Here's what was created: ...
```

The coder wrote the code, delegated docs to the writer, got the result back, and delivered a complete response. The user only talked to the coder.

## What's really happening

```
you: "build calculator + docs"
  ↓
[coder] starts loop
  ├── bash: writes calculator.py
  ├── ask_agent("writer", "write docs...")
  │     ↓
  │   [writer] starts fresh loop
  │     ├── bash: reads calculator.py
  │     ├── bash: writes README.md
  │     └── returns "Documentation complete."
  │     ↓
  │   result: "Documentation complete."
  ├── receives writer's result as tool response
  └── delivers final answer to user
```

## Key concepts

| Concept | What it means here |
|---------|-------------------|
| **Delegation as a tool** | Calling another agent is just another tool call |
| **Caller owns delivery** | The calling agent receives the result and decides what to do |
| **Fresh instance** | Delegated agents start with clean history — focused on one task |
| **Roster awareness** | Agents know who's available and what they specialize in |
| **Synchronous delegation** | Caller waits for result — simple, predictable control flow |

## Design considerations

**Why synchronous?** The calling agent's loop pauses while the delegate works. This is simple and predictable — the caller knows exactly when the result arrives. The tradeoff is that you can't parallelize: if the coder delegates to both the writer and the researcher, it waits for each sequentially. For most tasks, that's fine.

**Why fresh instances?** The delegated agent doesn't share the caller's history. This is deliberate — it prevents context contamination. The writer doesn't need to know about the coder's debugging journey. If you need shared context, pass it in the task description.

**Why not a queue?** At this stage, delegation is a function call — request in, result out. No persistence needed. If we later need fire-and-forget delegation, retries, or parallel execution, we'd add a queue. But the simplest thing that works is the right starting point.

## What's missing (and what's next)

- Delegation is synchronous — no parallel execution yet
- No persistence — if the process crashes, delegated work is lost
- The caller owns everything — no way for work to flow between agents independently

---

**Next**: Phase 3, Step 3 — where we add the infrastructure for agents to work independently.
