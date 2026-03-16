import { Agent } from "./agent.js";
import { loadAgentConfig, listAgents } from "./config.js";
import { initMemory } from "./memory.js";
import { startRepl, startFileWatcher, startClock } from "./triggers.js";
import { setProjectContext } from "./tools.js";
import { loadProjectConfig, initProject, appendProjectLog } from "./project.js";
import { showStartup, showProjectBanner } from "./display.js";

const explicitAgentName = process.env.AGENT_NAME || process.argv[2];

// Handle --list flag
if (explicitAgentName === "--list") {
  console.log("Available agents:");
  for (const name of listAgents()) console.log(`  - ${name}`);
  process.exit(0);
}

// Project setup (optional)
const projectName = process.env.PROJECT || "";
let project: string | undefined;

// Resolve agent name: explicit > project manager > "default"
let agentName = explicitAgentName || "default";

if (projectName) {
  const projectConfig = loadProjectConfig(projectName);

  // If no agent was explicitly specified, use the project's manager
  if (!explicitAgentName) {
    const managerEntry = Object.entries(projectConfig.team).find(([, role]) => role === "manager");
    if (managerEntry) agentName = managerEntry[0];
  }

  const role = projectConfig.team[agentName];
  if (!role) {
    console.error(`Agent "${agentName}" is not on the team for project "${projectName}".`);
    console.error(`Team members: ${Object.keys(projectConfig.team).join(", ")}`);
    process.exit(1);
  }
  initProject(projectConfig);
  setProjectContext(projectName, agentName);
  appendProjectLog(projectName, `[${agentName}] joined as ${role}`);
  project = projectName;
  showProjectBanner(projectName, projectConfig.goal, role, projectConfig.team);
}

const config = loadAgentConfig(agentName);
initMemory(config);
setProjectContext(project ?? "", agentName);

const agent = new Agent(config, project);
showStartup(config.name, config.description);

if (config.triggers.fileWatcher) {
  startFileWatcher((source, message) => agent.act(source, message));
}
if (config.triggers.clock) {
  startClock((source, message) => agent.act(source, message));
}
if (config.triggers.repl) {
  startRepl((source, message) => agent.act(source, message));
}
