import { postTask, listTasks, updateTask, hasOpenTasks, getMode, setMode } from "./src/workspace.js";
import { logEvent, setRunId, setEventAgent } from "./src/events.js";
import * as fs from "node:fs";

// --- clean state ---
if (fs.existsSync("workspace/tasks.json")) fs.writeFileSync("workspace/tasks.json", "[]");
if (fs.existsSync("workspace/settings.json")) fs.unlinkSync("workspace/settings.json");
if (fs.existsSync("workspace/events.jsonl")) fs.unlinkSync("workspace/events.jsonl");

setRunId("test-run");
setEventAgent("test");

let passed = 0;
let failed = 0;

function check(label: string, actual: string, expected: string | RegExp) {
  const ok = expected instanceof RegExp ? expected.test(actual) : actual.includes(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`    expected: ${expected}`);
    console.log(`    got:      ${actual}`);
    failed++;
  }
}

// --- tasks ---
console.log("\n[tasks]");
check("post task-001", postTask("build calculator", "manager"), "task-001");
check("post task-002 blocked", postTask("write docs", "manager", ["task-001"]), "blocked by: task-001");

check("list shows both", listTasks(), "task-001");
check("list shows blocked", listTasks(), "[BLOCKED]");

check("hasOpenTasks true (task-001 unblocked)", String(hasOpenTasks()), "true");

// blocked claim should fail
check("blocked claim rejected", updateTask("task-002", "writer", "claim"), "blocked by");

// claim and complete task-001 → unblocks task-002
check("claim task-001", updateTask("task-001", "coder", "claim"), "Claimed task-001");
check("complete task-001", updateTask("task-001", "coder", "complete", "done"), "Completed task-001");
check("claim task-002 now unblocked", updateTask("task-002", "writer", "claim"), "Claimed task-002");

// double-claim should fail
check("double claim rejected", updateTask("task-002", "researcher", "claim"), "status is in_progress");

// --- modes ---
console.log("\n[modes]");
check("default is autonomous", getMode(), "autonomous");
setMode("supervised");
check("set to supervised", getMode(), "supervised");
setMode("autonomous");
check("reset to autonomous", getMode(), "autonomous");

// --- events ---
console.log("\n[events]");
logEvent("agent_started", { description: "test agent" });
const lines = fs.readFileSync("workspace/events.jsonl", "utf-8").trim().split("\n");
check("event written", lines.length.toString(), /^[1-9]/);
const allEvts = lines.map(l => JSON.parse(l));
const startedEvt = allEvts.find((e: any) => e.type === "agent_started");
check("agent_started event exists", startedEvt ? "yes" : "no", "yes");
check("event has runId", startedEvt?.runId ?? "", "test-run");
check("event has agentName", startedEvt?.agentName ?? "", "test");

// --- task events in jsonl ---
const types = allEvts.map((e: any) => e.type);
check("task_posted events exist", types.filter((t: string) => t === "task_posted").length.toString(), /[2-9]/);
check("task_claimed events exist", types.some((t: string) => t === "task_claimed").toString(), "true");
check("task_completed events exist", types.some((t: string) => t === "task_completed").toString(), "true");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
