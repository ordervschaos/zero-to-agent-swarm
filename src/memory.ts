import * as fs from "node:fs";
import * as path from "node:path";
const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export function getMemoryPaths(agentName: string) {
  const agentDir = path.join(APP_DIR, "agents", agentName);
  return {
    memoryDir: agentDir,
    identityPath: path.join(agentDir, "identity.md"),
    notesPath: path.join(agentDir, "notes.md"),
  };
}

// Kept for backward compatibility — points to the active agent's notes
export let NOTES_PATH = "";

export function initMemory(agentName: string): void {
  const { memoryDir, notesPath } = getMemoryPaths(agentName);
  NOTES_PATH = notesPath;

  fs.mkdirSync(memoryDir, { recursive: true });
  try {
    fs.writeFileSync(notesPath, "", { flag: "ax" });
  } catch {
    /* already exists */
  }
}

export function loadMemory(agentName: string): string {
  const { identityPath, notesPath } = getMemoryPaths(agentName);
  const identity = fs.readFileSync(identityPath, "utf-8").trim();
  const notes = fs.readFileSync(notesPath, "utf-8").trim();
  let system = identity;
  if (notes) system += `\n\n## Your notes\n${notes}`;
  return system;
}
