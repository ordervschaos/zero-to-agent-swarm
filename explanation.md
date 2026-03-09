# Phase 2, Step 3: Bash Tool — The Agent Has Real Hands

## What changed from Step 2

The `list_files` tool is gone. In its place: a general-purpose `bash` tool. The agent can now run *any shell command* — create files, run scripts, install packages, pipe commands together.

## What was added

1. **`bash` tool** — Replaces `list_files`. Takes a `command` string, runs it with `execSync`, returns stdout/stderr
2. **Timeout** — Commands are killed after 30 seconds (`BASH_TIMEOUT`)
3. **Output truncation** — Output is capped at 10,000 characters (`MAX_OUTPUT`) to avoid flooding the LLM context
4. **`/workspace` volume** — A new mounted directory where the agent does its work, separate from its code in `/app`
5. **Error handling** — Failed commands return the exit code + stderr instead of crashing

## Why replace list_files with bash?

`list_files` was a single-purpose tool. `bash` subsumes it — `ls` is just one of infinite commands. With bash, the agent can:

- `ls`, `cat`, `find`, `grep` — everything list_files did, plus more
- `echo "hello" > file.txt` — create and write files
- `python3 script.py` — run programs
- `apt-get install` — install packages
- `curl` — make HTTP requests

One tool to rule them all. This is why we containerized first — bash is powerful and dangerous.

## Key code

```typescript
function runBash(command: string): string {
  try {
    const output = execSync(command, {
      timeout: BASH_TIMEOUT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.length > MAX_OUTPUT)
      return output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
    return output || "(no output)";
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    return `Exit code ${err.status ?? 1}\n${stdout}${stderr}`.trim();
  }
}
```

## Safety

- **Docker containment** (from Step 2) prevents the agent from touching your real filesystem
- **30s timeout** prevents infinite loops or hung processes
- **Output truncation** prevents the agent from drowning in output

Without Docker, this tool would be reckless. With Docker, it's safe to explore.

## What's next

The agent can now think and act, but it only wakes up when you type. In the next step, we add file watchers and a clock so it can wake itself up.
