# Zero to Agent Swarm

## Is this for you?

This tutorial is for engineers who already know how to build software but want to understand the **agent ecosystem**.

My aim is to give you mental models for designing **agent architectures, features, and systems**. By the end, you will understand how agents work and how multiple agents coordinate.

## The mental model

Computers already behave like primitive robots — they receive input, process information, and take actions. Agent systems extend this idea by combining **reasoning, tools, memory, and autonomy**.

*When does a chatbot become an agent?*

A chatbot answers questions. An agent has **goal-directed behavior** and can **act outside the conversation**.

Here is the model we'll build toward, one piece at a time:

> **Agent = Triggers + Thinking + Tools + Memory, in a Container**

## The roadmap

We build in three phases:

| Phase | Goal | What you'll have |
|-------|------|-----------------|
| **1. Birth** | Build a single agent from scratch | A working agent with a decision loop |
| **2. Upgrades** | Make it powerful and safe | Memory, containment, bash, autonomy |
| **3. Swarm** | Run multiple agents together | Specialized agents coordinating on tasks |

Let's build one.

---

# Phase 1: Birth of an Agent

We start from the most basic possible thing — a single LLM call, tokens in and tokens out — and build up step by step until we have something that genuinely qualifies as an agent.

---

## 1. Make it talk. A channel = 1 Trigger + 1 Tool

*Adding to the model: the first Trigger and the first Tool.*

A message arriving is a trigger. A reply going out is a tool. These two things always come as a pair — you can't have one without the other. Together they form the communication channel.

We start with the simplest possible version: a REPL. You type something, it prints it back. No LLM, no logic. Just the loop: input in, output out.

This is the scaffold everything else will hang on.

[Skill](./skills/phase-1-step-1-make-it-talk.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-1-step-1)

---

## 2. Make it think

*Adding to the model: Thinking.*

Now we wire in the LLM. The input still comes in through the same channel, but instead of echoing it back, we send it to the model and return what comes out.

Think of it like the association cortex — it takes input and transforms it. Tokens in, tokens out. At this stage the agent is a traditional question-answering chatbot: it can reason about what you say and respond, but it has no memory beyond the conversation and no way to act in the world.


[Skill](./skills/phase-1-step-2-make-it-think.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-1-step-2)

---

## 3. Give it another tool. Now it has a choice.

*Adding to the model: more Tools.*

Replying to the user is already a tool — the first one. Now we add a second. This is what gives the LLM a choice: based on the prompt, it decides whether to reply directly or invoke the other tool. No tool call means the default — print to user.

For this step we'll use a `list_files` tool — it lists the contents of a directory. It's a good first tool because it's read-only and relatively safe. The agent can look around but can't break anything.

[Skill](./skills/phase-1-step-3-give-it-hands.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-1-step-3)

---


## 4. Give it a decision loop

*Connecting the model: Thinking and Tools working together.*

Right now the agent thinks once and acts once. Without a loop, it shoots in the dark — it takes an action and stops. It doesn't check whether the action worked. It doesn't know if the task is done. It doesn't report back. It just stops.

The decision loop is the engine that binds thinking and tools together. It runs until there's an exit condition — the agent concludes the task is done and reports back. Until then it keeps going: think, act, observe the result, think again.

This is what separates a chatbot from an agent. The loop is not a new primitive — it's what makes the primitives work together.

[Skill](./skills/phase-1-step-4-decision-loop.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-1-step-4)

---

> **Checkpoint:** We now have Triggers + Thinking + Tools, connected by a decision loop. That's a working agent. The fun begins.

---

# Phase 2: Upgrades

Now that we have a basic agent, we'll make it more capable — and more safe. The arc here is: give it memory, then contain it, then give it real power, then let it act on its own.

---

## 1. Better memory

*Adding to the model: Memory.*

Right now, the agent is an amnesiac.

What it has is working memory — it remembers the conversation until it concludes, and then it's gone. Apart from the model's built-in knowledge and whatever is in the system prompt, it has nothing else to draw on. The system prompt helps, but it's limited and static.

We can upgrade memory in two ways:

**Always loaded** — files that get injected into every session automatically:
- `identity.md` — who the agent is, how it behaves. Human-curated. Stable.
- `notes.md` — what the agent has learned across past sessions. Agent-curated. Grows over time.

**Retrieval-based** — when memory grows too large to load in full, the agent queries it instead. Embeddings and vector search let it pull only what's relevant to the current task.

[Skill](./skills/phase-2-step-1-better-memory.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-2-step-1)

---

## 2. Stronger containment

*Adding to the model: the Container.*

With more power comes more responsibility. As we give the agent more tools and more autonomy, mistakes get expensive. At the application level, we can restrict what the agent is allowed to do — but these controls are code, and code has bugs.

The safer approach is an OS-level container. Here we define exactly what the world looks like for the agent: what filesystem it sees, what it can touch, what it can't. If the agent goes wrong and tries to delete everything it knows, your actual data stays safe.

We set up the container now, *before* giving the agent more power. Safety first.

[Skill](./skills/phase-2-step-2-containment.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-2-step-2)

---

## 3. More hands

*Expanding the model: powerful Tools, safely contained.*

Now that it's contained, we can safely give the agent real power.

Let's give it bash. The agent can now run the code it writes, do git operations, install packages, and — if we allow it — modify its own codebase. This is where things get interesting.

[Skill](./skills/phase-2-step-3-more-hands.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-2-step-3)

---

## 4. More triggers

*Expanding the model: more Triggers for autonomy.*

Currently, the agent wakes up when you call it, does its work, saves to memory, and goes back to sleep. You are the only trigger.

What if you want more? We add two new triggers: a **file watcher** that fires when something changes in the workspace, and a **clock** that fires on a schedule. Both feed into the same agent loop — the agent doesn't care how it was woken up.

[Skill](./skills/phase-2-step-4-more-triggers.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-2-step-4)

---

> **Checkpoint:** Our agent now has all the pieces — Triggers + Thinking + Tools + Memory, in a Container. Time to multiply it.

---

# Phase 3: A Party of Agents

Our agent is capable. But different tasks need different agents — and sometimes you need more than one running at the same time.

What actually separates one agent from another?

- Its identity
- Its memory
- The tools it has access to
- The filesystem it can see

All of the above. We package these together into a config — the agent's genome. Spin up a new config, you get a new agent. Each one manages its own work, its own memory, its own context. Just like in a real workplace: separation of concerns, access, and responsibility.

---

## 1. Agent genome

What makes one agent different from another? Define it in a config. From one codebase, you can instantiate as many specialized agents as you need.

[Skill](./skills/phase-3-step-1-agent-genome.skill) · [Code](https://github.com/ordervschaos/zero-to-agent-swarm/tree/phase-3-step-1)

---

## 2. Agent teams *(coming soon)*

Once you have multiple agents, you need coordination patterns.

1. Serial — one agent hands off to the next
2. Parallel — agents work simultaneously on different parts of a problem
