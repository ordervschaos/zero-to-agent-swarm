import { chat } from "./llm.js";
import type { Message } from "./llm.js";
import { loadMemory } from "./memory.js";
import { getDeclarations, executeTool } from "./tools.js";
import type { AgentConfig } from "./config.js";
import type { TriggerSource } from "./triggers.js";

const MAX_ITERATIONS = 10;

export class Agent {
  private history: Message[] = [];
  private busy = false;
  private tools;
  readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.tools = [{ functionDeclarations: getDeclarations(config.tools) }];
  }

  async act(source: TriggerSource, message: string): Promise<void> {
    if (this.busy) {
      console.log(`  [${this.config.name}] [skipped ${source} trigger — agent is busy]`);
      return;
    }
    this.busy = true;
    console.log(`\n  [${this.config.name}] [trigger: ${source}]`);
    this.history.push({ role: "user", parts: [{ text: `[${source}] ${message}` }] });
    try {
      await this.loop();
    } finally {
      this.busy = false;
    }
  }

  private async loop(): Promise<void> {
    const systemInstruction = loadMemory(this.config.name);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await chat(this.history, systemInstruction, this.tools);
      const functionCalls = response.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        console.log(`  [${this.config.name}] [tool: ${call.name}(${JSON.stringify(call.args)})]`);
        const result = executeTool(call.name!, call.args as Record<string, string>);

        this.history.push({ role: "model", parts: [{ functionCall: call }] });
        this.history.push({
          role: "function",
          parts: [{ functionResponse: { name: call.name!, response: { result } } }],
        });
      } else {
        const text = response.text ?? "";
        console.log(`${this.config.name}: ${text}`);
        this.history.push({ role: "model", parts: [{ text }] });
        return;
      }
    }

    console.log(`${this.config.name}: [max iterations reached]`);
  }
}
