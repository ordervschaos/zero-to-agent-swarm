import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Part, FunctionDeclaration } from "@google/genai";

export type { Part };

// A single message in the conversation history.
export type Message = { role: "user" | "model" | "function"; parts: Part[] };

const MODEL = "gemini-2.0-flash";
let ai: GoogleGenAI;

export type ToolMode = "auto" | "any" | "none";

// Send the current history to the model and return its response.
// Callers are responsible for appending messages to history before and after.
export async function chat(
  history: Message[],
  systemInstruction: string,
  tools: { functionDeclarations: FunctionDeclaration[] }[],
  toolMode: ToolMode = "auto"
) {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const modeMap: Record<ToolMode, FunctionCallingConfigMode> = {
    auto: FunctionCallingConfigMode.AUTO,
    any: FunctionCallingConfigMode.ANY,
    none: FunctionCallingConfigMode.NONE,
  };

  return ai.models.generateContent({
    model: MODEL,
    contents: history,
    config: {
      systemInstruction,
      tools,
      toolConfig: { functionCallingConfig: { mode: modeMap[toolMode] } },
    },
  });
}
