export type ScoutCommandRegistration = {
  name: string;
  summary: string;
  status?: "stable" | "deprecated";
  canonicalName?: string;
  deprecationMessage?: string;
};

export const SCOUT_COMMANDS: ScoutCommandRegistration[] = [
  { name: "help", summary: "Show help text" },
  { name: "version", summary: "Print the Scout CLI version" },
  { name: "setup", summary: "Bootstrap local settings and broker" },
  { name: "doctor", summary: "Show broker health and project inventory" },
  { name: "runtimes", summary: "Show harness catalog and readiness" },
  { name: "env", summary: "Show executable and agent identity context" },
  { name: "send", summary: "Post a broker-backed message" },
  { name: "speak", summary: "Send and speak aloud via TTS" },
  { name: "ask", summary: "Ask an agent and wait for the answer" },
  { name: "card", summary: "Create a dedicated relay agent card" },
  { name: "watch", summary: "Stream broker messages" },
  { name: "who", summary: "List agents and last activity" },
  { name: "enroll", summary: "Generate enrollment prompt" },
  { name: "broadcast", summary: "Send to all routable agents" },
  { name: "up", summary: "Spawn a local agent for a project" },
  { name: "down", summary: "Stop one or all local agents" },
  { name: "ps", summary: "List configured local agents" },
  { name: "restart", summary: "Restart configured local agents" },
  { name: "pair", summary: "Pair a companion device via QR" },
  {
    name: "init",
    summary: "Deprecated alias for setup",
    status: "deprecated",
    canonicalName: "setup",
    deprecationMessage: "scout init is deprecated; use scout setup.",
  },
];

export function listScoutPrimaryCommands(): ScoutCommandRegistration[] {
  return SCOUT_COMMANDS.filter((command) => (command.status ?? "stable") === "stable");
}

export function listScoutDeprecatedCommands(): ScoutCommandRegistration[] {
  return SCOUT_COMMANDS.filter((command) => command.status === "deprecated");
}

export function findScoutCommandRegistration(name: string): ScoutCommandRegistration | undefined {
  return SCOUT_COMMANDS.find((command) => command.name === name);
}
