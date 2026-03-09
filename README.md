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

Try: `list the files here, then check what's inside the src folder` — the agent will call `list_files` multiple times in a loop before responding.
