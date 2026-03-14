import { GoogleGenAI } from "@google/genai";
import type { Part, FunctionDeclaration } from "@google/genai";

export type { Part };

// A single message in the conversation history.
export type Message = { role: "user" | "model" | "function"; parts: Part[] };

const MODEL = "gemini-2.0-flash";
const DRY_RUN = process.env.DRY_RUN === "1";

const ai = DRY_RUN ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Dry-run mock — returns canned responses without calling the LLM. */
function mockChat(
  history: Message[],
  tools: { functionDeclarations: FunctionDeclaration[] }[]
) {
  // Find the latest user message to understand what's being asked
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const userText = lastUser?.parts?.[0] && "text" in lastUser.parts[0] ? lastUser.parts[0].text ?? "" : "";

  // Check if this agent has create_project available
  const hasCreateProject = tools.some((t) =>
    t.functionDeclarations.some((d) => d.name === "create_project")
  );

  // If the last message is a function response, return a text completion
  const lastMessage = history[history.length - 1];
  if (lastMessage?.role === "function") {
    return {
      text: `[dry-run] Acknowledged tool result. Moving on.`,
      functionCalls: undefined,
    };
  }

  // Orchestrator's first call → return a canned create_project call
  if (hasCreateProject && !history.some((m) => m.role === "function")) {
    return {
      text: undefined,
      functionCalls: [
        {
          name: "create_project",
          args: {
            project: userText.replace(/^\[.*?\]\s*/, ""),
            tasks: [
              {
                id: "t1",
                description: "Implement the core functionality",
                agent: "coder",
                depends_on: [],
              },
              {
                id: "t2",
                description: "Write tests for the implementation",
                agent: "coder",
                depends_on: ["t1"],
              },
              {
                id: "t3",
                description: "Write documentation",
                agent: "writer",
                depends_on: ["t1"],
              },
            ],
          },
        },
      ],
    };
  }

  // All other calls → return text completion
  const taskDesc = userText.replace(/^\[.*?\]\s*/, "");
  return {
    text: `[dry-run] Completed: ${taskDesc}`,
    functionCalls: undefined,
  };
}

// Send the current history to the model and return its response.
// Callers are responsible for appending messages to history before and after.
export async function chat(
  history: Message[],
  systemInstruction: string,
  tools: { functionDeclarations: FunctionDeclaration[] }[]
) {
  if (DRY_RUN) {
    return mockChat(history, tools);
  }

  return ai!.models.generateContent({
    model: MODEL,
    contents: history,
    config: { systemInstruction, tools },
  });
}
