# Zero to Agent Swarm

A step-by-step tutorial building an agent from scratch.

## Setup

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and set it:

```bash
export GEMINI_API_KEY="your-key-here"
```

## Run (local)

```bash
npm install
npm start
```

## Run (Docker)

```bash
docker compose run --rm agent
```

The agent runs inside a container with an isolated filesystem. Only the `memory/` directory is mounted through — everything else is sandboxed. If the agent goes wrong, your real files stay safe.

### Verify containment

Try these prompts inside the container:

- `list the files in /` — you'll see the container's filesystem, not your host
- `list the files in /app` — only the app code and memory are visible
- `list the files in /home` — empty. Your home directory doesn't exist here
