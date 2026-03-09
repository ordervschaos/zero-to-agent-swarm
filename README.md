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

The agent runs inside a container with a `bash` tool — it can run any shell command safely. Two directories are mounted through:

- `memory/` — persistent identity and notes
- `workspace/` — the agent's working directory for creating files

**Important:** After editing source files, you must rebuild with `docker compose build` before running again. Docker won't pick up changes automatically.

## Run (local)

```bash
npm install
npm start
```

**Warning:** locally the agent can run bash on your real machine. Use Docker for safety.

## Try it

```
you: write a python script that prints the first 10 fibonacci numbers, save it, and run it
```

The agent should use its `bash` tool to create the file, install python if needed, and run it:

```
  [tool: bash({"command":"echo \"def fibonacci(n):...\" > fibonacci.py"})]
  [tool: bash({"command":"python3 fibonacci.py"})]
agent: Here are the first 10 fibonacci numbers: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34
```

More prompts to try:

- `what OS am I running on?` — the agent runs `uname` or `cat /etc/os-release`
- `create a file called hello.txt with "hello world" in it` — check `workspace/hello.txt` on your host after
- `my name is Alice, remember that` — restart and ask `what's my name?` to test persistent memory
