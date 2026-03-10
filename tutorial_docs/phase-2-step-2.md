# Phase 2, Step 2: Docker Containment — Sandbox Before Power

## What changed from Step 1

Zero code changes. The agent source is identical. What's new is a **container** — the agent now runs inside Docker, isolated from your real machine.

## What was added

1. **`Dockerfile`** — Builds a Node.js container with the agent code baked in. Memory is mounted at runtime, not baked in
2. **`docker-compose.yml`** — Defines the service: passes through `GEMINI_API_KEY`, mounts `./memory` into the container, enables stdin/tty for the REPL

## Why containerize now?

We're about to give the agent a `bash` tool — the ability to run arbitrary shell commands. Without containment, `rm -rf /` is one hallucination away. Inside Docker:

- The agent can only touch `/app` (its code) and `/app/memory` (mounted from host)
- It can't access your files, network services, or other processes
- If it breaks something, you just rebuild the container

**The rule: sandbox before power.** Always contain the agent *before* giving it dangerous capabilities.

## How it works

```bash
# Build the image (bakes in code)
docker compose build

# Run (mounts memory, passes API key)
docker compose run --rm agent
```

The agent doesn't know it's in a container. The REPL works exactly the same. The only difference is where `list_files` can see — it sees the container filesystem, not your host.

## Key files

```dockerfile
# Dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY tsconfig.json ./
COPY src ./src
VOLUME /app/memory
CMD ["npx", "tsx", "src/index.ts"]
```

```yaml
# docker-compose.yml
services:
  agent:
    build: .
    stdin_open: true
    tty: true
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - ./memory:/app/memory
```

## What's next

Now that the agent is sandboxed, we can safely replace `list_files` with a full `bash` tool.
