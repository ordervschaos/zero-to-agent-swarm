# Phase 1, Step 2: Wire In the LLM — Make It Think

## What changed from Step 1

The echo is gone. In its place: a real LLM call to Gemini. The agent now *thinks* about your input before responding.

## What was added

1. **Gemini SDK** — `@google/genai` package added as a dependency
2. **API call** — Each user message is sent to `gemini-2.0-flash` with a system instruction
3. **Conversation history** — An in-memory array tracks the back-and-forth (`user` and `model` turns), so the LLM has context for follow-up questions

## Key changes

```typescript
// Before (Step 1): echo
console.log(`agent: ${input}`);

// After (Step 2): think
const response = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: history,
  config: { systemInstruction: "You are a helpful assistant. Be concise." },
});
console.log(`agent: ${response.text}`);
```

The `prompt()` function became `async` because the LLM call is asynchronous.

## What the agent can do now

- Understand natural language
- Answer questions, summarize, reason
- Remember what you said earlier *in the same session* (history array)

## What it still can't do

- Use tools — it can only talk, not act
- Remember anything after you restart (history is in-memory)
- Do more than one thing per turn

## What's next

In the next step, we give the agent its first tool — `list_files` — so it can look at the filesystem.
