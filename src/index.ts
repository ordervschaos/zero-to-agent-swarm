import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration, Part } from "@google/genai";

// --- Stopping condition: cap iterations so the agent can't loop forever ---
const MAX_ITERATIONS = 10;

// --- Thinking: the LLM that powers the agent's reasoning ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Tool declaration: tells the LLM what tools exist and how to call them ---
// This is the schema the model sees. It never runs this — it just knows
// "list_files" is available, what it does, and what arguments it takes.
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

// --- Tool implementation: the actual code that runs when the model calls a tool ---
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

// --- Tool router: maps tool names to implementations ---
function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "list_files":
      return listFiles(args.directory);
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- Working memory: conversation history that accumulates across the loop ---
// This is the context the LLM sees on every call. It grows with each
// user message, model response, and tool result.
const history: { role: "user" | "model" | "function"; parts: Part[] }[] = [];

// --- Trigger: the REPL that turns user input into agent invocations ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// --- Context assembly: system prompt + identity + available tools ---
// This config is sent with every LLM call. It shapes how the agent
// perceives input and what tools it knows it can use.
const toolConfig = {
  systemInstruction: "You are a helpful assistant. Be concise.",
  tools: [{ functionDeclarations: [listFilesDeclaration] }],
};

// --- The Loop: think → act → observe, repeat until done or max steps ---
async function agentLoop() {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Think: send full context to the LLM
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: history,
      config: toolConfig,
    });

    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      // Act: the model chose a tool — execute it
      const call = functionCalls[0];
      console.log(`  [tool: ${call.name}(${JSON.stringify(call.args)})]`);
      const result = executeTool(call.name!, call.args as Record<string, any>);

      // Observe: record the tool call and its result into working memory
      // so the next iteration can see what happened
      history.push({ role: "model", parts: [{ functionCall: call }] });
      history.push({
        role: "function",
        parts: [{ functionResponse: { name: call.name!, response: { result } } }],
      });
      // Loop continues — think again with the tool result
    } else {
      // Done: the model produced a text response instead of a tool call
      const text = response.text ?? "";
      console.log(`agent: ${text}`);
      history.push({ role: "model", parts: [{ text }] });
      return;
    }
  }

  // Stopping condition: hard cap hit
  console.log("agent: [max iterations reached]");
}

// --- Trigger loop: wait for user input, run the agent, repeat ---
async function prompt() {
  rl.question("you: ", async (input) => {
    history.push({ role: "user", parts: [{ text: input }] });
    await agentLoop();
    prompt();
  });
}

prompt();
