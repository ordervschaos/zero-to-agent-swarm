# Quickstart

Get the agent running in under 2 minutes.

## 1. Get an API key

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and set it:

```bash
export GEMINI_API_KEY="your-key-here"
```

## 2. Run with Docker (recommended)

```bash
docker compose build
docker compose run --rm agent
```

Type a message and press Enter. The agent will respond.

> After editing source files, rebuild with `docker compose build` before running again.

## 3. Run locally (alternative)

```bash
npm install
npm start
```

**Warning:** locally the agent can run bash on your real machine. Use Docker for safety.

## Running a specific agent

The system supports multiple agent configs in `agents/`. By default it starts the `default` agent.

```bash
# Start a specific agent locally
npm start researcher

# Start a specific agent in Docker
AGENT_NAME=researcher docker compose run --rm agent

# List available agents
npm start -- --list
```

Create a new agent by adding a JSON file to `agents/`. See [Phase 3 tutorial](./tutorial_docs/phase-3-step-1.md) for details.

## Triggers

The agent wakes up from three sources. All can run simultaneously.

### REPL (always on)

Type a message and press Enter.

### File watcher

Watch a directory for changes:

```bash
WATCH_DIR=/workspace docker compose run --rm agent
```

Test it: in another terminal, run `echo "hello" > workspace/test.txt`.

### Clock

Run the agent on a schedule:

```bash
CRON_SCHEDULE="*/1 * * * *" CRON_PROMPT="Check the workspace for new files and summarize them." docker compose run --rm agent
```

### All together

```bash
WATCH_DIR=/workspace CRON_SCHEDULE="*/5 * * * *" CRON_PROMPT="Check the workspace for new files and summarize them." docker compose run --rm agent
```

## Next steps

**[Read the full tutorial](./tutorial_docs/tutorial.md)** to understand the architecture behind every piece.
