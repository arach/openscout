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
  { name: "whoami", summary: "Resolve your current Scout sender identity" },
  { name: "send", summary: "Tell one target or post to an explicit channel" },
  { name: "speak", summary: "Send and speak aloud via TTS" },
  { name: "ask", summary: "Hand work to one agent and wait for the answer" },
  { name: "card", summary: "Create a dedicated reply-ready Scout agent card" },
  { name: "watch", summary: "Stream broker messages" },
  { name: "who", summary: "List agents and last activity" },
  { name: "latest", summary: "Show the latest Scout activity" },
  { name: "mcp", summary: "Run a Scout MCP server over stdio" },
  { name: "enroll", summary: "Generate enrollment prompt" },
  { name: "broadcast", summary: "Broadcast to channel.shared" },
  { name: "up", summary: "Spawn a local agent for a project" },
  { name: "down", summary: "Stop one or all local agents" },
  { name: "ps", summary: "List configured local agents" },
  { name: "restart", summary: "Restart configured local agents" },
  { name: "menu", summary: "Launch the OpenScout macOS menu bar app" },
  { name: "config", summary: "View or set user config (name, etc.)" },
  { name: "mesh", summary: "Mesh status and diagnostics" },
  { name: "pair", summary: "Pair a companion device via QR" },
  { name: "server", summary: "Run the Scout web UI (Bun; see: scout server start / control-plane start)" },
  { name: "tui", summary: "Terminal monitor dashboard" },
  { name: "init", summary: "Write ~/.openscout/config.json with broker/web/pairing ports" },
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
