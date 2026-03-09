import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration, Part } from "@google/genai";

const MAX_ITERATIONS = 10;
const MEMORY_DIR = path.resolve("memory");
const IDENTITY_PATH = path.join(MEMORY_DIR, "identity.md");
const NOTES_PATH = path.join(MEMORY_DIR, "notes.md");

// Ensure memory directory and files exist
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

const listFilesDeclaration: FunctionDeclaration = {
  name: "list_files",
  description: "List files and directories at a given path.",
  parametersJsonSchema: {
    type: Type.OBJECT,
    properties: {
      directory: {
        type: Type.STRING,
        description: "The directory path to list. Defaults to current directory.",
      },
    },
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

function listFiles(directory: string): string {
  const dir = path.resolve(directory || ".");
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

function saveNote(note: string): string {
  fs.appendFileSync(NOTES_PATH, `- ${note}\n`);
  return "Note saved.";
}

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "list_files":
      return listFiles(args.directory);
    case "save_note":
      return saveNote(args.note);
    default:
      return `Unknown tool: ${name}`;
  }
}

const history: { role: "user" | "model" | "function"; parts: Part[] }[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function agentLoop() {
  const toolConfig = {
    systemInstruction: loadMemory(),
    tools: [{ functionDeclarations: [listFilesDeclaration, saveNoteDeclaration] }],
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

async function prompt() {
  rl.question("you: ", async (input) => {
    history.push({ role: "user", parts: [{ text: input }] });
    await agentLoop();
    prompt();
  });
}

prompt();
