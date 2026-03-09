import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import { loadMemory } from "./memory.js";
import { allDeclarations, executeTool } from "./tools.js";
import { startRepl, startFileWatcher, startClock } from "./triggers.js";

const MAX_ITERATIONS = 10;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const history: { role: "user" | "model" | "function"; parts: Part[] }[] = [];
let busy = false;

async function agentLoop() {
  const config = {
    systemInstruction: loadMemory(),
    tools: [{ functionDeclarations: allDeclarations }],
  };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: history,
      config,
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

async function handleTrigger(source: string, message: string) {
  if (busy) {
    console.log(`  [skipped ${source} trigger — agent is busy]`);
    return;
  }
  busy = true;
  console.log(`\n  [trigger: ${source}]`);
  history.push({ role: "user", parts: [{ text: `[${source}] ${message}` }] });
  try {
    await agentLoop();
  } finally {
    busy = false;
  }
}

console.log("Agent started.");
startFileWatcher(handleTrigger);
startClock(handleTrigger);
startRepl(handleTrigger);
