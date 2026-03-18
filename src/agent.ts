import { chat } from "./llm.js";
import type { Message } from "./llm.js";
import { loadMemory } from "./memory.js";
import { getDeclarations, executeTool } from "./tools.js";
import { listAgents, loadAgentConfig } from "./config.js";
import type { AgentConfig } from "./config.js";
import type { TriggerSource } from "./triggers.js";
import {
  showTrigger,
  showBusy,
  showToolCall,
  showDelegationStart,
  showDelegationEnd,
  showAgentResponse,
  showMaxIterations,
} from "./display.js";

const DEFAULT_MAX_ITERATIONS = 10;

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
      showBusy(this.config.name, source);
      return;
    }
    this.busy = true;
    showTrigger(this.config.name, source);
    this.history.push({ role: "user", parts: [{ text: `[${source}] ${message}` }] });
    try {
      await this.loop();
    } finally {
      this.busy = false;
    }
  }

  // --- Inline mode (called by another agent via ask_agent) ---

  async run(request: string): Promise<string> {
    showDelegationStart(this.config.name);
    this.history.push({ role: "user", parts: [{ text: request }] });
    const result = await this.loop();
    showDelegationEnd(this.config.name);
    return result;
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
    const systemInstruction =
      loadMemory(this.config.name) +
      this.buildSwarmRoster();

    const maxIter = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    for (let i = 0; i < maxIter; i++) {
      const response = await chat(this.history, systemInstruction, this.tools);
      const functionCalls = response.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        showToolCall(this.config.name, call.name!, call.args as Record<string, any>);
        const result = await executeTool(call.name!, call.args as Record<string, string>);

        this.history.push({ role: "model", parts: [{ functionCall: call }] });
        this.history.push({
          role: "function",
          parts: [{ functionResponse: { name: call.name!, response: { result } } }],
        });
      } else {
        const text = response.text ?? "";
        showAgentResponse(this.config.name, text);
        this.history.push({ role: "model", parts: [{ text }] });
        return text;
      }
    }

    showMaxIterations(this.config.name);
    return "[max iterations reached]";
  }
}
