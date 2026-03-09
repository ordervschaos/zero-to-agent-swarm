import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const MEMORY_DIR = path.join(APP_DIR, "memory");
export const IDENTITY_PATH = path.join(MEMORY_DIR, "identity.md");
export const NOTES_PATH = path.join(MEMORY_DIR, "notes.md");

// Ensure memory files exist
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);
if (!fs.existsSync(IDENTITY_PATH))
  fs.writeFileSync(IDENTITY_PATH, "You are a helpful assistant. Be concise.\n");
if (!fs.existsSync(NOTES_PATH))
  fs.writeFileSync(NOTES_PATH, "");

export function loadMemory(): string {
  const identity = fs.readFileSync(IDENTITY_PATH, "utf-8").trim();
  const notes = fs.readFileSync(NOTES_PATH, "utf-8").trim();
  let system = identity;
  if (notes) system += `\n\n## Your notes\n${notes}`;
  return system;
}
