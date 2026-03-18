import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { showWatcher, showClock, showPoll } from "./display.js";
import { hasOpenTasks } from "./workspace.js";

// Named trigger sources — keeps callers from scattering raw strings.
export type TriggerSource = "user" | "file-change" | "clock" | "poll";
export type TriggerHandler = (source: TriggerSource, message: string) => Promise<void>;

// 1. REPL — user input
export function startRepl(onTrigger: TriggerHandler) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function prompt() {
    rl.question("you: ", async (input) => {
      await onTrigger("user", input);
      prompt();
    });
  }

  prompt();
}

// 2. File watcher
export function startFileWatcher(onTrigger: TriggerHandler) {
  const watchDir = process.env.WATCH_DIR;
  if (!watchDir) return;

  const dir = path.resolve(watchDir);
  if (!fs.existsSync(dir)) {
    showWatcher(`directory not found: ${dir}`);
    return;
  }
  showWatcher(`watching ${dir}`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      onTrigger("file-change", `File changed: ${filename} in ${dir}`);
    }, 500);
  });
}

// 3. Poll — workspace poller for worker agents
const POLL_INTERVAL_MS = 3000;
const POLL_PROMPT = "Check the workspace for an open task. Claim one and complete it. Write your result as an artifact and mark the task done. If there are no open tasks, respond with 'idle'.";

export function startPoll(onTrigger: TriggerHandler) {
  showPoll(POLL_INTERVAL_MS);
  setInterval(async () => {
    if (!hasOpenTasks()) return;
    await onTrigger("poll", POLL_PROMPT);
  }, POLL_INTERVAL_MS);
}

// 4. Clock — simple interval-based scheduler
export function startClock(onTrigger: TriggerHandler) {
  const schedule = process.env.CRON_SCHEDULE;
  if (!schedule) return;

  const prompt = process.env.CRON_PROMPT || "Run your scheduled maintenance tasks.";

  // Parse "*/N * * * *" = every N minutes
  const match = schedule.match(/^\*\/(\d+)/);
  if (!match) {
    showClock(`only "*/N * * * *" style supported, got: ${schedule}`);
    return;
  }
  const minutes = parseInt(match[1], 10);
  showClock(`running every ${minutes} minute(s)`);

  setInterval(() => {
    onTrigger("clock", prompt);
  }, minutes * 60 * 1000);
}
