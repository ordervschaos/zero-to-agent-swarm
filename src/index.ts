import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration, Part } from "@google/genai";

const MAX_ITERATIONS = 10;

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

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "list_files":
      return listFiles(args.directory);
    default:
      return `Unknown tool: ${name}`;
  }
}

const history: { role: "user" | "model" | "function"; parts: Part[] }[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const toolConfig = {
  systemInstruction: "You are a helpful assistant. Be concise.",
  tools: [{ functionDeclarations: [listFilesDeclaration] }],
};

async function agentLoop() {
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
      // Loop continues — think again with the tool result
    } else {
      const text = response.text ?? "";
      console.log(`agent: ${text}`);
      history.push({ role: "model", parts: [{ text }] });
      return; // Done — agent chose to reply
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
