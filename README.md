# Zero to Agent Swarm

A step-by-step tutorial building an agent from scratch.

## Setup

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and set it:

```bash
export GEMINI_API_KEY="your-key-here"
```

## Run (Docker — recommended)

Build the image (re-run this after any code changes):

```bash
docker compose build
```

Start the agent:

```bash
docker compose run --rm agent
```

**Important:** After editing source files, you must rebuild with `docker compose build` before running again.

## Triggers

The agent wakes up from three sources:

### 1. REPL (always on)

Type a message and press Enter — same as before.

### 2. File watcher

Watch a directory for changes. When a file is created or modified, the agent wakes up.

```bash
WATCH_DIR=/workspace docker compose run --rm agent
```

Test it: in another terminal, run `echo "hello" > workspace/test.txt`. The agent will see:

```
  [trigger: file-change]
agent: A file called test.txt was created in the workspace.
```

### 3. Clock

Run the agent on a schedule. Uses `*/N * * * *` syntax (every N minutes).

```bash
CRON_SCHEDULE="*/1 * * * *" CRON_PROMPT="Check the workspace for new files and summarize them." docker compose run --rm agent
```

The agent will wake every minute and run the prompt:

```
  [trigger: clock]
  [tool: bash({"command":"ls /workspace"})]
agent: The workspace currently contains...
```

### Combining triggers

All three work at the same time:

```bash
WATCH_DIR=/workspace CRON_SCHEDULE="*/5 * * * *" docker compose run --rm agent
```

## Run (local)

```bash
npm install
WATCH_DIR=./workspace CRON_SCHEDULE="*/1 * * * *" npm start
```

**Warning:** locally the agent can run bash on your real machine. Use Docker for safety.
