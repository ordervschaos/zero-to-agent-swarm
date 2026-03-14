#!/usr/bin/env tsx
// Live task board — updates in-place with colors.
// Usage: npm run viz

import { getAllTasks } from "./task-queue.js";

const REFRESH_MS = 500;

// ANSI helpers
const c = {
  reset:  "\x1B[0m",
  bold:   "\x1B[1m",
  dim:    "\x1B[2m",
  green:  "\x1B[32m",
  yellow: "\x1B[33m",
  red:    "\x1B[31m",
  cyan:   "\x1B[36m",
  magenta:"\x1B[35m",
  bgGreen:  "\x1B[42m\x1B[30m",
  bgYellow: "\x1B[43m\x1B[30m",
  bgRed:    "\x1B[41m\x1B[37m",
  bgCyan:   "\x1B[46m\x1B[30m",
  bgMagenta:"\x1B[45m\x1B[37m",
};

const cols = Math.min(process.stdout.columns || 80, 100);

function badge(status: string): string {
  switch (status) {
    case "done":        return `${c.bgGreen} DONE ${c.reset}`;
    case "in-progress": return `${c.bgYellow} WORK ${c.reset}`;
    case "pending":     return `${c.bgCyan} NEXT ${c.reset}`;
    case "blocked":     return `${c.bgMagenta} WAIT ${c.reset}`;
    case "failed":      return `${c.bgRed} FAIL ${c.reset}`;
    default:            return ` ${status} `;
  }
}

function agentColor(agent: string): string {
  const palette = [c.cyan, c.yellow, c.magenta, c.green, c.red];
  let h = 0;
  for (const ch of agent) h = (h + ch.charCodeAt(0)) % palette.length;
  return palette[h];
}

/** Truncate to terminal width, accounting for ANSI escape sequences. */
function fit(text: string): string {
  const visible = text.replace(/\x1B\[[0-9;]*m/g, "");
  if (visible.length <= cols) return text;
  let visCount = 0;
  let i = 0;
  while (i < text.length && visCount < cols - 1) {
    if (text[i] === "\x1B") {
      const end = text.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visCount++;
    i++;
  }
  return text.slice(0, i) + c.reset;
}

function render(): string {
  const tasks = getAllTasks();
  const lines: string[] = [];

  const time = new Date().toLocaleTimeString();
  lines.push("");
  lines.push(`  ${c.bold}TASK BOARD${c.reset}  ${c.dim}${time}${c.reset}`);
  lines.push(`  ${c.dim}${"-".repeat(cols - 4)}${c.reset}`);

  if (tasks.length === 0) {
    lines.push("");
    lines.push(`  ${c.dim}Waiting for tasks...${c.reset}`);
    lines.push("");
    lines.push(`  ${c.dim}Ctrl+C to exit${c.reset}`);
    return lines.join("\n");
  }

  const roots = tasks.filter(t => t.parent_id === null);
  const children = (pid: number) => tasks.filter(t => t.parent_id === pid);

  for (const root of roots) {
    const subs = children(root.id);
    if (subs.length > 0) {
      lines.push("");
      lines.push(fit(`  ${c.bold}${root.description}${c.reset}`));
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const isLast = i === subs.length - 1;
        const branch = isLast ? "\u2514" : "\u251C";
        const ac = agentColor(sub.assigned_to);
        const dep = sub.depends_on.length > 0 ? ` ${c.dim}<- [${sub.depends_on.join(",")}]${c.reset}` : "";
        lines.push(fit(
          `   ${c.dim}${branch}${c.reset} ${badge(sub.status)} ${ac}${sub.assigned_to}${c.reset} ${sub.description}${dep}`
        ));
      }
    } else {
      lines.push(fit(
        `  ${badge(root.status)} ${agentColor(root.assigned_to)}${root.assigned_to}${c.reset} ${root.description}`
      ));
    }
  }

  // Summary bar
  lines.push("");
  lines.push(`  ${c.dim}${"-".repeat(cols - 4)}${c.reset}`);
  const ct: Record<string, number> = {};
  for (const t of tasks) ct[t.status] = (ct[t.status] ?? 0) + 1;
  const parts = [
    ct["done"]        ? `${c.green}${ct["done"]} done${c.reset}`           : null,
    ct["in-progress"] ? `${c.yellow}${ct["in-progress"]} working${c.reset}`: null,
    ct["pending"]     ? `${c.cyan}${ct["pending"]} pending${c.reset}`      : null,
    ct["blocked"]     ? `${c.magenta}${ct["blocked"]} blocked${c.reset}`   : null,
    ct["failed"]      ? `${c.red}${ct["failed"]} failed${c.reset}`        : null,
  ].filter(Boolean);
  lines.push(`  ${parts.join(`${c.dim} | ${c.reset}`)}`);
  lines.push("");
  lines.push(`  ${c.dim}Ctrl+C to exit${c.reset}`);
  lines.push("");

  return lines.join("\n");
}

function draw() {
  const content = render();
  const lines = content.split("\n");
  const out = "\x1B[H" + lines.map(l => l + "\x1B[K").join("\n") + "\n\x1B[J";
  process.stdout.write(out);
}

// Use alternate screen buffer for clean rendering
process.stdout.write("\x1B[?1049h");
process.stdout.write("\x1B[?25l"); // hide cursor
process.on("exit", () => {
  process.stdout.write("\x1B[?1049l");
  process.stdout.write("\x1B[?25h\n");
});
process.on("SIGINT", () => process.exit());

draw();
setInterval(draw, REFRESH_MS);
