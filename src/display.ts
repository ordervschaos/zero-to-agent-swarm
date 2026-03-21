/**
 * Centralized REPL display formatting.
 * All console output goes through here for consistent, readable output.
 */

import { logBus } from "./log-events.js";

function emit(type: string, agent: string, data: Record<string, unknown>): void {
  logBus.emit("log", { type, agent, data, timestamp: new Date().toISOString() });
}

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const ICONS = {
  agent: "\u25B6",     // ▶
  tool: "\u2192",      // →
  delegate: "\u21B3",  // ↳
  done: "\u2713",      // ✓
  log: "\u2502",       // │
  corner: "\u2514",    // └
};

// Track delegation depth for indentation
let delegationDepth = 0;

function indent(): string {
  return COLORS.gray + ICONS.log + COLORS.reset + "  ".repeat(delegationDepth);
}

// --- Startup banners ---

export function showStartup(agentName: string, description: string): void {
  console.log("");
  console.log(`${COLORS.bold}${COLORS.cyan}${ICONS.agent} Agent: ${agentName}${COLORS.reset}${COLORS.dim} — ${description}${COLORS.reset}`);
  emit("startup", agentName, { description });
}

// --- Trigger events ---

export function showTrigger(agentName: string, source: string): void {
  console.log(`\n${indent()}${COLORS.cyan}${agentName}${COLORS.reset} ${COLORS.dim}[${source}]${COLORS.reset}`);
  emit("trigger", agentName, { source });
}

export function showBusy(agentName: string, source: string): void {
  console.log(`${indent()}${COLORS.dim}${agentName} skipped ${source} — busy${COLORS.reset}`);
  emit("busy", agentName, { source });
}

// --- Tool calls ---

export function showToolCall(agentName: string, toolName: string, args: Record<string, any>): void {
  const prefix = `${indent()}${COLORS.gray}${ICONS.tool}${COLORS.reset} `;

  switch (toolName) {
    case "ask_agent": {
      const target = args.agent || "?";
      const task = args.task || "";
      const short = task.length > 80 ? task.slice(0, 80) + "..." : task;
      console.log(`${prefix}${COLORS.blue}delegate${COLORS.reset} ${COLORS.bold}${target}${COLORS.reset}${COLORS.dim}: ${short}${COLORS.reset}`);
      break;
    }
    case "bash": {
      const cmd = args.command || "";
      console.log(`${prefix}${COLORS.yellow}bash${COLORS.reset}${COLORS.dim}: ${truncate(cmd, 70)}${COLORS.reset}`);
      break;
    }
    case "save_note": {
      console.log(`${prefix}${COLORS.dim}save_note${COLORS.reset}`);
      break;
    }
    case "post_task": {
      console.log(`${prefix}${COLORS.green}+task${COLORS.reset}${COLORS.dim}: ${truncate(args.title || "", 70)}${COLORS.reset}`);
      break;
    }
    case "list_tasks": {
      const status = args.status || "(all)";
      console.log(`${prefix}${COLORS.dim}list_tasks: ${status}${COLORS.reset}`);
      break;
    }
    case "update_task": {
      const action = args.action || "?";
      const statusColor = action === "complete" ? COLORS.green : COLORS.yellow;
      console.log(`${prefix}${statusColor}${action}${COLORS.reset} ${args.task_id || "?"}${args.result ? COLORS.dim + " — " + truncate(args.result, 60) + COLORS.reset : ""}`);
      break;
    }
    case "write_artifact": {
      const key = args.key || "?";
      console.log(`${prefix}${COLORS.magenta}artifact write${COLORS.reset}${COLORS.dim}: ${key}${COLORS.reset}`);
      break;
    }
    case "read_artifact": {
      const key = args.key || "(all)";
      console.log(`${prefix}${COLORS.dim}artifact read: ${key}${COLORS.reset}`);
      break;
    }
    default: {
      console.log(`${prefix}${toolName}(${COLORS.dim}${truncate(JSON.stringify(args), 60)}${COLORS.reset})`);
    }
  }
  emit("tool", agentName, { tool: toolName, args });
}

// --- Delegation ---

export function showDelegationStart(agentName: string): void {
  console.log(`${indent()}${COLORS.gray}${ICONS.delegate}${COLORS.reset} ${COLORS.cyan}${agentName}${COLORS.reset}${COLORS.dim} working...${COLORS.reset}`);
  delegationDepth++;
  emit("delegation_start", agentName, {});
}

export function showDelegationEnd(agentName: string): void {
  delegationDepth = Math.max(0, delegationDepth - 1);
  console.log(`${indent()}${COLORS.gray}${ICONS.corner}${COLORS.reset} ${COLORS.cyan}${agentName}${COLORS.reset}${COLORS.dim} done${COLORS.reset}`);
  emit("delegation_end", agentName, {});
}

// --- Agent responses ---

export function showAgentResponse(agentName: string, text: string): void {
  if (!text.trim()) return;
  // For delegated agents, show a compact summary
  if (delegationDepth > 0) {
    const short = text.length > 120 ? text.slice(0, 120) + "..." : text;
    console.log(`${indent()}${COLORS.cyan}${agentName}${COLORS.reset}: ${COLORS.dim}${short}${COLORS.reset}`);
  } else {
    console.log(`\n${COLORS.bold}${agentName}${COLORS.reset}: ${text}\n`);
  }
  emit("response", agentName, { text });
}

export function showMaxIterations(agentName: string): void {
  console.log(`${indent()}${COLORS.red}${agentName}: max iterations reached${COLORS.reset}`);
  emit("max_iterations", agentName, {});
}

// --- Utility ---

export function showInfo(message: string): void {
  console.log(`${COLORS.dim}${message}${COLORS.reset}`);
}

export function showWatcher(message: string): void {
  console.log(`${COLORS.dim}  [watch] ${message}${COLORS.reset}`);
}

export function showClock(message: string): void {
  console.log(`${COLORS.dim}  [clock] ${message}${COLORS.reset}`);
}

function truncate(s: string, max: number): string {
  // Collapse newlines for display
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ");
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}
