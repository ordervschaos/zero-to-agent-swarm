import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { NOTES_PATH } from "./memory.js";

const BASH_TIMEOUT = 30_000;
const MAX_OUTPUT = 10_000;

// --- Declarations ---

export const bashDeclaration: FunctionDeclaration = {
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

export const saveNoteDeclaration: FunctionDeclaration = {
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

export const allDeclarations = [bashDeclaration, saveNoteDeclaration];

// --- Implementations ---

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

export function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "bash":
      return runBash(args.command);
    case "save_note":
      return saveNote(args.note);
    default:
      return `Unknown tool: ${name}`;
  }
}
