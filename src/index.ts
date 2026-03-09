import * as readline from "node:readline";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const history: { role: "user" | "model"; parts: { text: string }[] }[] = [];

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
      },
    });

    const text = response.text ?? "";
    console.log(`agent: ${text}`);
    history.push({ role: "model", parts: [{ text }] });

    prompt();
  });
}

prompt();
