import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration, Part } from "@google/genai";

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

async function prompt() {
  rl.question("you: ", async (input) => {
    history.push({ role: "user", parts: [{ text: input }] });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: history,
      config: {
        systemInstruction: "You are a helpful assistant. Be concise.",
        tools: [{ functionDeclarations: [listFilesDeclaration] }],
      },
    });

    const functionCalls = response.functionCalls;

    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      const result = executeTool(call.name!, call.args as Record<string, any>);
      console.log(`result: ${result}`);
    } else {
      const text = response.text ?? "";
      console.log(`agent: ${text}`);
      history.push({ role: "model", parts: [{ text }] });
    }

    prompt();
  });
}

prompt();
