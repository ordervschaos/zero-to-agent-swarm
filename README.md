# Zero to Agent Swarm

A step-by-step tutorial building an agent from scratch.

## Setup

```bash
npm install
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and set it:

```bash
export GEMINI_API_KEY="your-key-here"
```

## Run

```bash
npm start
```

Type a message and press Enter. The agent responds using Gemini.

Try: `my name is Alice, remember that` — the agent saves it to `memory/notes.md`. Restart the process and ask `what's my name?` — it still knows.

Edit `memory/identity.md` to change who the agent is. Notes in `memory/notes.md` are agent-curated and grow over time.
