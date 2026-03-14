import { chat } from "./llm.js";
import type { Message } from "./llm.js";
import { loadMemory } from "./memory.js";
import { getDeclarations, executeTool } from "./tools.js";
import { listAgents, loadAgentConfig } from "./config.js";
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

  // --- Trigger mode (user-facing agent) ---

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

  // --- Inline mode (called by another agent via ask_agent) ---

  async run(request: string): Promise<string> {
    console.log(`\n  [${this.config.name}] [delegated task]`);
    this.history.push({ role: "user", parts: [{ text: request }] });
    return this.loop();
  }

  // --- Core agentic loop ---

  private buildSwarmRoster(): string {
    const agents = listAgents();
    const lines = agents
      .filter((name) => name !== this.config.name)
      .map((name) => {
        const cfg = loadAgentConfig(name);
        return `  - ${name}: ${cfg.description}`;
      });
    if (lines.length === 0) return "";
    return `\n\nYou can delegate tasks to other agents using the ask_agent tool. The agent will complete the task and return its result to you.\nAvailable agents:\n${lines.join("\n")}`;
  }

  private async loop(): Promise<string> {
    const systemInstruction = loadMemory(this.config.name) + this.buildSwarmRoster();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await chat(this.history, systemInstruction, this.tools);
      const functionCalls = response.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        console.log(`  [${this.config.name}] [tool: ${call.name}(${JSON.stringify(call.args)})]`);
        const result = await executeTool(call.name!, call.args as Record<string, string>);

        this.history.push({ role: "model", parts: [{ functionCall: call }] });
        this.history.push({
          role: "function",
          parts: [{ functionResponse: { name: call.name!, response: { result } } }],
        });
      } else {
        const text = response.text ?? "";
        console.log(`${this.config.name}: ${text}`);
        this.history.push({ role: "model", parts: [{ text }] });
        return text;
      }
    }

    console.log(`${this.config.name}: [max iterations reached]`);
    return "[max iterations reached]";
  }
}
