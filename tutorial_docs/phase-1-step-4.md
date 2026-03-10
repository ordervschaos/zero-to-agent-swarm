# Phase 1, Step 4: Decision Loop — Think, Act, Observe, Repeat

## What changed from Step 3

The single tool call is now a **loop**. The agent can call tools as many times as it needs before deciding to respond with text. This is the classic agent loop pattern.

## What was added

1. **`agentLoop()` function** — Replaces the inline logic. Loops up to `MAX_ITERATIONS` (10), calling the LLM each time
2. **Loop-until-done pattern** — If the LLM returns a function call, execute it and loop. If it returns text, print it and stop
3. **Safety cap** — After 10 iterations, the loop stops to prevent infinite tool-calling
4. **Tool call logging** — Each tool call is printed: `[tool: list_files({"directory":"/"})]`

## The agent loop pattern

```
User sends a message
  └→ agentLoop():
       ├→ LLM returns function call? → execute tool → loop again
       ├→ LLM returns function call? → execute tool → loop again
       ├→ LLM returns text? → print and STOP
       └→ Hit 10 iterations? → force stop
```

This is the same pattern used by ChatGPT, Claude, and every other tool-using agent. The LLM *chooses* when to stop — it can call tools 0 times (just answer) or many times (research, then answer).

## Key code

```typescript
async function agentLoop() {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ai.models.generateContent({ ... });
    if (functionCalls) {
      // execute tool, add to history, loop continues
    } else {
      // text response — we're done
      console.log(`agent: ${text}`);
      return;
    }
  }
  console.log("agent: [max iterations reached]");
}
```

## What the agent can do now

- Chain multiple tool calls: "List the files, then check what's inside src/"
- The LLM autonomously decides how many tools to call before answering

## End of Phase 1

At this point you have a complete, minimal agent: it thinks (LLM), acts (tools), observes (tool results), and loops. Phase 2 adds real-world capabilities on top of this foundation.
