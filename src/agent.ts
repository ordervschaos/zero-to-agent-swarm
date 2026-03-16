import { chat } from "./llm.js";
import type { Message } from "./llm.js";
import { loadMemory } from "./memory.js";
import { getDeclarations, executeTool } from "./tools.js";
import { listAgents, loadAgentConfig } from "./config.js";
import type { AgentConfig } from "./config.js";
import type { TriggerSource } from "./triggers.js";
import { loadProjectConfig, loadProjectLog, getRole } from "./project.js";
import {
  showTrigger,
  showBusy,
  showToolCall,
  showDelegationStart,
  showDelegationEnd,
  showAgentResponse,
  showMaxIterations,
} from "./display.js";

const MAX_ITERATIONS = 10;

export class Agent {
  private history: Message[] = [];
  private busy = false;
  private tools;
  readonly config: AgentConfig;
  private project?: string;

  constructor(config: AgentConfig, project?: string) {
    this.config = config;
    this.project = project;
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
    if (this.project) {
      const projectConfig = loadProjectConfig(this.project);
      const lines = Object.entries(projectConfig.team)
        .filter(([name]) => name !== this.config.name)
        .map(([name, role]) => {
          const cfg = loadAgentConfig(name);
          return `  - ${name} (${role}): ${cfg.description}`;
        });
      if (lines.length === 0) return "";
      return `\n\nYou can delegate tasks to other agents using the ask_agent tool. The agent will complete the task and return its result to you.\nTeam members:\n${lines.join("\n")}`;
    }

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

  private buildProjectContext(): string {
    if (!this.project) return "";
    const config = loadProjectConfig(this.project);
    const role = getRole(this.project, this.config.name);
    const log = loadProjectLog(this.project);

    return `\n\n## Active Project: ${config.name}\nGoal: ${config.goal}\nYour role: ${role}\n\n## Project Log\n${log}`;
  }

  private async loop(): Promise<string> {
    const systemInstruction =
      loadMemory(this.config.name) +
      this.buildProjectContext() +
      this.buildSwarmRoster();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
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
