import { GoogleGenAI } from "@google/genai";
import type { Part, FunctionDeclaration } from "@google/genai";

export type { Part };

// A single message in the conversation history.
export type Message = { role: "user" | "model" | "function"; parts: Part[] };

const MODEL = "gemini-2.0-flash";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Send the current history to the model and return its response.
// Callers are responsible for appending messages to history before and after.
export async function chat(
  history: Message[],
  systemInstruction: string,
  tools: { functionDeclarations: FunctionDeclaration[] }[]
) {
  return ai.models.generateContent({
    model: MODEL,
    contents: history,
    config: { systemInstruction, tools },
  });
}
