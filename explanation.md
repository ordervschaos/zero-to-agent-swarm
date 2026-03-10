# Phase 1, Step 3: Add list_files Tool — The Agent Has a Choice

## What changed from Step 2

The agent can now *do* something besides talk. We gave it a `list_files` tool, and the LLM decides on its own whether to use it or answer directly.

## What was added

1. **Tool declaration** — A `list_files` function declaration tells the LLM what the tool does and what parameters it accepts (using JSON Schema)
2. **Tool implementation** — A `listFiles()` function that reads a directory and returns the entries
3. **Tool execution flow** — After the LLM responds, we check if it wants to call a tool. If yes, we run the tool, feed the result back, and get a final text response

## How function calling works

```
User: "What files are in this directory?"
  → LLM receives message + tool declarations
  → LLM responds with: functionCall: { name: "list_files", args: { directory: "." } }
  → We execute listFiles(".")
  → We send the result back to the LLM
  → LLM responds with: "The directory contains: src/, package.json, ..."
```

The LLM doesn't execute anything — it *requests* a function call. We execute it and feed the result back. This is the core pattern behind all agent tool use.

## Key code

```typescript
const functionCalls = response.functionCalls;
if (functionCalls && functionCalls.length > 0) {
  const call = functionCalls[0];
  const result = executeTool(call.name!, call.args);
  // Feed result back to LLM for a final answer
  history.push({ role: "model", parts: [{ functionCall: call }] });
  history.push({ role: "function", parts: [{ functionResponse: { name: call.name!, response: { result } } }] });
  // Get final response...
}
```

## Limitation

The agent can only call **one tool per turn**. If it calls `list_files`, it gets one shot to respond — it can't then call it again on a subdirectory. That's fixed in the next step.

## What's next

In the next step, we add a loop so the agent can call tools multiple times before giving a final answer.
