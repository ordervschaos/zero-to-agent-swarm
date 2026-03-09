import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration, Part } from "@google/genai";

const MAX_ITERATIONS = 10;
const BASH_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MEMORY_DIR = path.join(APP_DIR, "memory");
const IDENTITY_PATH = path.join(MEMORY_DIR, "identity.md");
const NOTES_PATH = path.join(MEMORY_DIR, "notes.md");
const WATCH_DIR = process.env.WATCH_DIR || "";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || ""; // e.g. "*/5 * * * *"
const CRON_PROMPT = process.env.CRON_PROMPT || "Run your scheduled maintenance tasks.";

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);
if (!fs.existsSync(IDENTITY_PATH))
  fs.writeFileSync(IDENTITY_PATH, "You are a helpful assistant. Be concise.\n");
if (!fs.existsSync(NOTES_PATH))
  fs.writeFileSync(NOTES_PATH, "");

function loadMemory(): string {
  const identity = fs.readFileSync(IDENTITY_PATH, "utf-8").trim();
  const notes = fs.readFileSync(NOTES_PATH, "utf-8").trim();
  let system = identity;
  if (notes) system += `\n\n## Your notes\n${notes}`;
  return system;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Tool declarations ---

const bashDeclaration: FunctionDeclaration = {
  name: "bash",
  description:
    "Execute a shell command and return stdout/stderr. Use this to: create and write files, run scripts (python, node, etc.), install packages, explore the filesystem, or perform any task achievable from a terminal.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The shell command to execute.",
      },
    },
    required: ["command"],
  },
};

const saveNoteDeclaration: FunctionDeclaration = {
  name: "save_note",
  description:
    "Save a note to persistent memory. Use this to remember things across sessions.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      note: {
        type: Type.STRING,
        description: "The note to save.",
      },
    },
    required: ["note"],
  },
};

// --- Tool implementations ---

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

function saveNote(note: string): string {
  fs.appendFileSync(NOTES_PATH, `- ${note}\n`);
  return "Note saved.";
}

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- Agent loop ---

const history: { role: "user" | "model" | "function"; parts: Part[] }[] = [];
let busy = false;

async function agentLoop() {
  const toolConfig = {
    systemInstruction: loadMemory(),
    tools: [{ functionDeclarations: [bashDeclaration, saveNoteDeclaration] }],
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: history,
      config: toolConfig,
    });

    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log(`  [tool: ${call.name}(${JSON.stringify(call.args)})]`);
      const result = executeTool(call.name!, call.args as Record<string, any>);

      history.push({ role: "model", parts: [{ functionCall: call }] });
      history.push({
        role: "function",
        parts: [{ functionResponse: { name: call.name!, response: { result } } }],
      });
    } else {
      const text = response.text ?? "";
      console.log(`agent: ${text}`);
      history.push({ role: "model", parts: [{ text }] });
      return;
    }
  }

  console.log("agent: [max iterations reached]");
}

async function handleTrigger(source: string, message: string) {
  if (busy) {
    console.log(`  [skipped ${source} trigger — agent is busy]`);
    return;
  }
  busy = true;
  console.log(`\n  [trigger: ${source}]`);
  history.push({ role: "user", parts: [{ text: `[${source}] ${message}` }] });
  try {
    await agentLoop();
  } finally {
    busy = false;
  }
}

// --- Triggers ---

// 1. REPL — user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt() {
  rl.question("you: ", async (input) => {
    await handleTrigger("user", input);
    prompt();
  });
}

// 2. File watcher
function startFileWatcher() {
  if (!WATCH_DIR) return;
  const dir = path.resolve(WATCH_DIR);
  if (!fs.existsSync(dir)) {
    console.log(`  [watch] directory not found: ${dir}`);
    return;
  }
  console.log(`  [watch] watching ${dir}`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      handleTrigger("file-change", `File changed: ${filename} in ${dir}`);
    }, 500); // debounce 500ms to batch rapid changes
  });
}

// 3. Clock — cron-style scheduler (simple interval-based)
function startClock() {
  if (!CRON_SCHEDULE) return;

  // Parse simple interval from cron-like syntax: "*/N * * * *" = every N minutes
  const match = CRON_SCHEDULE.match(/^\*\/(\d+)/);
  if (!match) {
    console.log(`  [clock] only "*/N * * * *" style supported, got: ${CRON_SCHEDULE}`);
    return;
  }
  const minutes = parseInt(match[1], 10);
  const ms = minutes * 60 * 1000;
  console.log(`  [clock] running every ${minutes} minute(s)`);

  setInterval(() => {
    handleTrigger("clock", CRON_PROMPT);
  }, ms);
}

// --- Start ---

console.log("Agent started.");
startFileWatcher();
startClock();
prompt();
