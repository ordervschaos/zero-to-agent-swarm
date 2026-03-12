import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

// Named trigger sources — keeps callers from scattering raw strings.
export type TriggerSource = "user" | "file-change" | "clock";
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
    console.log(`  [watch] directory not found: ${dir}`);
    return;
  }
  console.log(`  [watch] watching ${dir}`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      onTrigger("file-change", `File changed: ${filename} in ${dir}`);
    }, 500);
  });
}

// 3. Clock — simple interval-based scheduler
export function startClock(onTrigger: TriggerHandler) {
  const schedule = process.env.CRON_SCHEDULE;
  if (!schedule) return;

  const prompt = process.env.CRON_PROMPT || "Run your scheduled maintenance tasks.";

  // Parse "*/N * * * *" = every N minutes
  const match = schedule.match(/^\*\/(\d+)/);
  if (!match) {
    console.log(`  [clock] only "*/N * * * *" style supported, got: ${schedule}`);
    return;
  }
  const minutes = parseInt(match[1], 10);
  console.log(`  [clock] running every ${minutes} minute(s)`);

  setInterval(() => {
    onTrigger("clock", prompt);
  }, minutes * 60 * 1000);
}
