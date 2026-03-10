# Phase 1, Step 1: Echo REPL — The Simplest Agent Scaffold

## What this step builds

This is the starting point — the absolute minimum "agent" you can build. It's not smart, it doesn't think, and it has no LLM. It's just a loop.

## What happens

- A readline REPL prompts you with `you: `
- Whatever you type, it echoes back as `agent: <your input>`
- Then it prompts you again — forever

## Why start here

Every agent, no matter how sophisticated, has the same skeleton:

1. **Receive input** (from a user, a file, a webhook, a clock)
2. **Process it** (echo, LLM call, tool chain — doesn't matter yet)
3. **Produce output** (print to console, send a message, write a file)
4. **Loop**

This step isolates the skeleton. The REPL is trigger #1. The echo is the simplest possible "processing." The console.log is the output. The recursive `prompt()` call is the loop.

## Key code

```typescript
function prompt() {
  rl.question("you: ", (input) => {
    console.log(`agent: ${input}`);
    prompt(); // loop
  });
}
```

## What's next

In the next step, we replace the echo with a real LLM call — same loop, but now it thinks.
