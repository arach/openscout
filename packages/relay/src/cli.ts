#!/usr/bin/env node

const VERSION = "0.2.0";
const BRAND = "\x1b[32m◆\x1b[0m";

const args = process.argv.slice(2);
const command = args[0];

function print(msg: string) {
  console.log(msg);
}

function printBrand() {
  print(`\n  ${BRAND} \x1b[1mOpenScout\x1b[0m v${VERSION}\n`);
}

function help() {
  printBrand();
  print("  \x1b[2mAgent-forward development platform for builders\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    init              Scaffold a new agent workspace");
  print("    add <type>        Add an agent, tool, or workflow");
  print("    run               Run your agents");
  print("    list              List configured agents and tools");
  print("    relay             File-based agent chat (relay --help)");
  print("    --help, -h        Show this help message");
  print("    --version, -v     Show version\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    npx openscout init");
  print("    openscout add agent --name reviewer");
  print("    openscout run\n");
  print(`  \x1b[2mhttps://openscout.app\x1b[0m\n`);
}

async function init() {
  printBrand();

  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "my-project";

  print(`  Initializing OpenScout in \x1b[1m${projectName}\x1b[0m...\n`);

  // Create config directory
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const configDir = path.join(cwd, ".openscout");
  await fs.mkdir(configDir, { recursive: true });

  // Create config file
  const config = {
    name: projectName,
    version: "0.1.0",
    agents: [],
    tools: [],
    workflows: [],
    settings: {
      model: "auto",
      local: true,
      streaming: true,
    },
  };

  await fs.writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );

  // Create agents directory
  await fs.mkdir(path.join(configDir, "agents"), { recursive: true });

  // Create tools directory
  await fs.mkdir(path.join(configDir, "tools"), { recursive: true });

  // Create example agent
  const exampleAgent = {
    name: "scout",
    description: "Default agent for general tasks",
    model: "auto",
    tools: [],
    instructions: "You are a helpful development agent.",
  };

  await fs.writeFile(
    path.join(configDir, "agents", "scout.json"),
    JSON.stringify(exampleAgent, null, 2) + "\n"
  );

  print("  \x1b[32m✓\x1b[0m Created .openscout/config.json");
  print("  \x1b[32m✓\x1b[0m Created .openscout/agents/scout.json");
  print("  \x1b[32m✓\x1b[0m Created .openscout/agents/");
  print("  \x1b[32m✓\x1b[0m Created .openscout/tools/\n");
  print("  \x1b[1mNext steps:\x1b[0m");
  print("    openscout add agent --name <name>");
  print("    openscout run\n");
}

async function add() {
  const type = args[1];

  if (!type) {
    print("\n  \x1b[31m✗\x1b[0m Missing type. Usage: openscout add <agent|tool>\n");
    process.exit(1);
  }

  const nameIdx = args.indexOf("--name");
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  if (!name) {
    print(`\n  \x1b[31m✗\x1b[0m Missing --name. Usage: openscout add ${type} --name <name>\n`);
    process.exit(1);
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configDir = path.join(cwd, ".openscout");

  // Check if initialized
  try {
    await fs.access(path.join(configDir, "config.json"));
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  if (type === "agent") {
    const agent = {
      name,
      description: "",
      model: "auto",
      tools: [],
      instructions: `You are the ${name} agent.`,
    };

    await fs.writeFile(
      path.join(configDir, "agents", `${name}.json`),
      JSON.stringify(agent, null, 2) + "\n"
    );

    // Update config
    const configRaw = await fs.readFile(path.join(configDir, "config.json"), "utf-8");
    const config = JSON.parse(configRaw);
    config.agents.push(name);
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );

    print(`\n  \x1b[32m✓\x1b[0m Added agent \x1b[1m${name}\x1b[0m`);
    print(`  \x1b[2m→ .openscout/agents/${name}.json\x1b[0m\n`);
  } else if (type === "tool") {
    const tool = {
      name,
      description: "",
      command: "",
    };

    await fs.writeFile(
      path.join(configDir, "tools", `${name}.json`),
      JSON.stringify(tool, null, 2) + "\n"
    );

    const configRaw = await fs.readFile(path.join(configDir, "config.json"), "utf-8");
    const config = JSON.parse(configRaw);
    config.tools.push(name);
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    );

    print(`\n  \x1b[32m✓\x1b[0m Added tool \x1b[1m${name}\x1b[0m`);
    print(`  \x1b[2m→ .openscout/tools/${name}.json\x1b[0m\n`);
  } else {
    print(`\n  \x1b[31m✗\x1b[0m Unknown type: ${type}. Use \x1b[1magent\x1b[0m or \x1b[1mtool\x1b[0m.\n`);
    process.exit(1);
  }
}

async function list() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configPath = path.join(cwd, ".openscout", "config.json");

  try {
    await fs.access(configPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  const configRaw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  printBrand();

  print("  \x1b[1mAgents:\x1b[0m");
  if (config.agents.length === 0) {
    print("    \x1b[2m(none — run openscout add agent --name <name>)\x1b[0m");
  } else {
    for (const a of config.agents) {
      print(`    ${BRAND} ${a}`);
    }
  }

  print("\n  \x1b[1mTools:\x1b[0m");
  if (config.tools.length === 0) {
    print("    \x1b[2m(none — run openscout add tool --name <name>)\x1b[0m");
  } else {
    for (const t of config.tools) {
      print(`    ▣ ${t}`);
    }
  }
  print("");
}

async function run() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cwd = process.cwd();
  const configPath = path.join(cwd, ".openscout", "config.json");

  try {
    await fs.access(configPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Not initialized. Run \x1b[1mopenscout init\x1b[0m first.\n");
    process.exit(1);
  }

  const configRaw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  printBrand();
  print("  Starting agents...\n");

  if (config.agents.length === 0) {
    print("  \x1b[33m!\x1b[0m No agents configured. Add one with:");
    print("    openscout add agent --name <name>\n");
    return;
  }

  for (const name of config.agents) {
    const agentPath = path.join(cwd, ".openscout", "agents", `${name}.json`);
    try {
      const raw = await fs.readFile(agentPath, "utf-8");
      const agent = JSON.parse(raw);
      print(`  \x1b[32m●\x1b[0m ${agent.name} \x1b[2m— ${agent.description || agent.instructions}\x1b[0m`);
    } catch {
      print(`  \x1b[33m○\x1b[0m ${name} \x1b[2m— config not found\x1b[0m`);
    }
  }

  print("\n  \x1b[2mAgent runtime coming soon.\x1b[0m\n");
}

// ── Relay ──────────────────────────────────────────────

function getAgentName(): string {
  const asIdx = args.indexOf("--as");
  if (asIdx !== -1 && args[asIdx + 1]) return args[asIdx + 1];
  if (process.env.OPENSCOUT_AGENT) return process.env.OPENSCOUT_AGENT;
  return `agent-${process.pid}`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatLine(line: string): string {
  const parts = line.split(" ");
  if (parts.length < 3) return line;
  const [ts, from, type, ...rest] = parts;
  const time = formatTimestamp(Number(ts));
  const body = rest.join(" ");
  if (type === "SYS") {
    return `  \x1b[2m${time} ∙ ${body}\x1b[0m`;
  }
  if (type === "ACK") {
    return `  \x1b[2m${time} ${from} ✓ ack ${body}\x1b[0m`;
  }
  return `  \x1b[2m${time}\x1b[0m \x1b[1m${from}\x1b[0m  ${body}`;
}

// ── Relay Path Resolution ─────────────────────────────
// Global hub: ~/.openscout/relay/
// Local link: .openscout/relay.json → { "hub": "~/.openscout/relay" }
// Resolution order:
//   1. Local .openscout/relay.json (if it has a "hub" pointer)
//   2. Global ~/.openscout/relay/
//   3. Fail with init instructions

interface RelayPaths {
  hub: string;       // the global relay directory
  logPath: string;   // hub + channel.log
  configPath: string; // hub + config.json
}

async function getGlobalRelayDir(): Promise<string> {
  const path = await import("node:path");
  const os = await import("node:os");
  return path.join(os.homedir(), ".openscout", "relay");
}

async function resolveRelayPaths(): Promise<RelayPaths | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // 1. Check for local link file
  const localLink = path.join(process.cwd(), ".openscout", "relay.json");
  try {
    const raw = await fs.readFile(localLink, "utf-8");
    const config = JSON.parse(raw);
    if (config.hub) {
      const hub = config.hub.replace(/^~/, (await import("node:os")).homedir());
      return {
        hub,
        logPath: path.join(hub, "channel.log"),
        configPath: path.join(hub, "config.json"),
      };
    }
  } catch {
    // No local link — fall through
  }

  // 2. Check global relay
  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");
  try {
    await fs.access(logPath);
    return { hub, logPath, configPath: path.join(hub, "config.json") };
  } catch {
    return null;
  }
}

async function requireRelay(): Promise<RelayPaths> {
  const paths = await resolveRelayPaths();
  if (!paths) {
    print("\n  \x1b[31m✗\x1b[0m Relay not initialized. Run \x1b[1mopenscout relay init\x1b[0m first.\n");
    process.exit(1);
  }
  return paths;
}

// ── Relay Config ──────────────────────────────────────

interface RelayConfig {
  agents: string[];
  created: number;
  projectRoot?: string;  // e.g. "~/dev" — where bare project names are resolved
  speakFor?: string;     // agent name to speak @mentions for (e.g. "arach")
  speakVoice?: string;   // OpenAI TTS voice (default: "nova")
  roster?: string[];     // project names to auto-start as twins (e.g. ["dev", "lattices", "arc"])
}

async function loadRelayConfig(): Promise<RelayConfig> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const configPath = path.join(hub, "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { agents: [], created: Date.now() };
  }
}

async function saveRelayConfig(config: RelayConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const configPath = path.join(hub, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

async function resolveProjectPath(target: string): Promise<string> {
  const path = await import("node:path");
  const os = await import("node:os");

  // Absolute or home-relative paths pass through
  if (target.startsWith("/")) return target;
  if (target.startsWith("~")) return target.replace("~", os.homedir());

  // Bare name → look up projectRoot from config, fallback to ~/dev
  const config = await loadRelayConfig();
  const root = config.projectRoot
    ? config.projectRoot.replace(/^~/, os.homedir())
    : path.join(os.homedir(), "dev");

  return path.join(root, target);
}

async function relayInit() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  // Create global relay hub
  const hub = await getGlobalRelayDir();
  await fs.mkdir(hub, { recursive: true });

  const configPath = path.join(hub, "config.json");
  const logPath = path.join(hub, "channel.log");

  // Write config if it doesn't exist
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(
      configPath,
      JSON.stringify({ agents: [], created: Date.now() }, null, 2) + "\n"
    );
  }

  // Create log if it doesn't exist
  try {
    await fs.access(logPath);
  } catch {
    await fs.writeFile(logPath, "");
  }

  // Create local link in current project (so agents in this dir find the hub)
  const localDir = path.join(process.cwd(), ".openscout");
  await fs.mkdir(localDir, { recursive: true });
  const linkPath = path.join(localDir, "relay.json");
  const hubShort = hub.replace(os.homedir(), "~");
  await fs.writeFile(
    linkPath,
    JSON.stringify({ hub: hubShort, linkedAt: new Date().toISOString() }, null, 2) + "\n"
  );

  // Write a SYS init line
  const ts = Math.floor(Date.now() / 1000);
  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  await fs.appendFile(logPath, `${ts} ${projectName} SYS ${projectName} linked to the relay\n`);

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Global relay hub: \x1b[1m${hubShort}/\x1b[0m`);
  print(`  \x1b[32m✓\x1b[0m Local link: \x1b[1m.openscout/relay.json\x1b[0m → hub`);
  print(`  \x1b[32m✓\x1b[0m Channel log: \x1b[1m${hubShort}/channel.log\x1b[0m\n`);
  print("  \x1b[2mAll projects linked to the same hub share one channel.\x1b[0m");
  print("  \x1b[2mRun this in each project directory to link it.\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay send --as agent-a \"hello\"");
  print("    openscout relay read");
  print("    openscout relay watch --as agent-a\n");
}

interface AgentRegistryEntry {
  pane: string;
  cwd: string;
  project: string;
  session_id?: string;
  registered_at?: number;
}

async function loadRegistry(): Promise<Record<string, AgentRegistryEntry>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const registryPath = path.join(hub, "agents.json");
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function speakIfEnabled(name: string, from: string, message: string): Promise<void> {
  const config = await loadRelayConfig();
  const speakFor = config.speakFor;
  if (!speakFor || speakFor !== name) return;

  // Find API key
  let apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    try {
      const path = await import("node:path");
      const os = await import("node:os");
      const raw = (await import("node:fs")).readFileSync(
        path.join(os.homedir(), ".config", "speakeasy", "settings.json"), "utf-8"
      );
      apiKey = JSON.parse(raw).providers?.openai?.apiKey || null;
    } catch { /* noop */ }
  }
  if (!apiKey) return;

  const clean = message.replace(new RegExp(`@${name}\\s*`, "g"), "").trim();
  if (!clean) return;

  try {
    const { spawn } = await import("node:child_process");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice: config.speakVoice || "nova", input: clean, response_format: "pcm", speed: 1.1 }),
    });
    if (!res.ok || !res.body) return;

    const player = spawn("ffplay", [
      "-nodisp", "-autoexit", "-loglevel", "quiet",
      "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-",
    ], { stdio: ["pipe", "ignore", "ignore"] });

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      player.stdin.write(value);
    }
    player.stdin.end();
    // Don't await — let it play in background, don't block delivery
  } catch { /* noop */ }
}

async function deliverToAgent(name: string, from: string, message: string): Promise<"delivered" | "nudged" | "queued"> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");
  const registry = await loadRegistry();
  const entry = registry[name];
  const hub = await getGlobalRelayDir();

  // Speak the message if TTS is enabled for this target
  speakIfEnabled(name, from, message);

  // Strategy 0: Check if target is a twin — deliver directly via tmux input
  const twins = await loadTwins();
  const twin = twins[name];
  if (twin && isTmuxSessionAlive(twin.tmuxSession)) {
    // Type the message directly into the twin's Claude prompt
    const prompt = `[Relay from ${from}]: ${message}`;
    try {
      execSync(`tmux send-keys -t ${twin.tmuxSession} ${JSON.stringify(prompt)} Enter`);
      return "delivered";
    } catch {
      // tmux session exists but can't send — fall through to inbox
    }
  }

  // Strategy 1: Write to inbox file — the agent's Stop hook picks it up
  // This is the most reliable cross-session delivery mechanism
  const inboxDir = path.join(hub, "inbox");
  await fs.mkdir(inboxDir, { recursive: true });
  const inboxFile = path.join(inboxDir, `${name}.md`);

  const relayMsg = [
    `[RELAY MESSAGE]`,
    `From: ${from}`,
    `To: @${name}`,
    ``,
    message,
    ``,
    `---`,
    `Reply with: openscout relay send --as ${name} "@${from} <your response>"`,
  ].join("\n") + "\n\n";

  // Append to inbox (multiple messages can queue up)
  await fs.appendFile(inboxFile, relayMsg);

  // Strategy 2: Also try tmux nudge for immediate visibility
  if (entry?.pane) {
    const preview = message.length > 60 ? message.slice(0, 60) + "…" : message;
    try {
      execSync(`tmux send-keys -t ${entry.pane} ${JSON.stringify(`[relay] ${from}: ${preview}`)} Enter`);
      return "nudged";
    } catch {
      // Pane doesn't exist — inbox delivery still happened
    }
  }

  return "delivered";
}

// ── @system agent ─────────────────────────────────────

async function handleSystemCommand(from: string, message: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");

  // Strip the @system prefix and parse the command
  const stripped = message.replace(/@system\s*/i, "").trim();
  const parts = stripped.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (!cmd) {
    return "usage: @system up <name> | down <name> | down --all | ps | config root <path>";
  }

  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");

  if (cmd === "ps") {
    const twins = await loadTwins();
    const names = Object.keys(twins);
    if (names.length === 0) return "no twins running";

    const now = Math.floor(Date.now() / 1000);
    const lines: string[] = [];
    for (const name of names) {
      const twin = twins[name];
      const alive = isTmuxSessionAlive(twin.tmuxSession);
      const uptime = now - twin.startedAt;
      const uptimeStr = uptime < 60 ? `${uptime}s`
        : uptime < 3600 ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h`;
      const icon = alive ? "●" : "✗";
      lines.push(`${icon} ${name} (${twin.project}, ${uptimeStr})`);
    }
    return lines.join(" | ");
  }

  if (cmd === "roster") {
    const sub = parts[1];
    const config = await loadRelayConfig();

    if (sub === "add" && parts[2]) {
      const name = parts[2];
      config.roster = config.roster || [];
      if (!config.roster.includes(name)) {
        config.roster.push(name);
        await saveRelayConfig(config);
      }
      return `added ${name} to roster (${config.roster.length} total)`;
    }

    if (sub === "remove" && parts[2]) {
      const name = parts[2];
      config.roster = (config.roster || []).filter((n) => n !== name);
      await saveRelayConfig(config);
      return `removed ${name} from roster`;
    }

    // Show roster
    const roster = config.roster || [];
    if (roster.length === 0) return "roster is empty — add with: @system roster add <name>";
    const twins = await loadTwins();
    const status = roster.map((name) => {
      const twin = twins[name];
      const alive = twin && isTmuxSessionAlive(twin.tmuxSession);
      return `${alive ? "●" : "○"} ${name}`;
    });
    return status.join("  ");
  }

  if (cmd === "up") {
    const target = parts[1];

    // No args = bring up the whole roster
    if (!target) {
      const config = await loadRelayConfig();
      const roster = config.roster || [];
      if (roster.length === 0) return "no roster configured — add with: @system roster add <name>";

      const results: string[] = [];
      for (const name of roster) {
        const tmuxSession = `relay-${name}`;
        if (isTmuxSessionAlive(tmuxSession)) {
          results.push(`${name} (already up)`);
          continue;
        }
        // Spawn using same logic as single up
        let projectPath: string;
        try {
          projectPath = await resolveProjectPath(name);
          const stat = await fs.stat(projectPath);
          if (!stat.isDirectory()) { results.push(`${name} (not found)`); continue; }
        } catch { results.push(`${name} (not found)`); continue; }

        const projectName = path.basename(projectPath);
        const twinName = name;
        const hubShort = hub.replace(os.homedir(), "~");
        const systemPrompt = [
          `You are "${twinName}", a relay twin for the ${projectName} project.`,
          `You have full access to the codebase at ${projectPath}.`,
          `Relay channel at ${hubShort}/channel.log shared by all agents.`,
          `Respond to @${twinName} mentions, answer questions about this project, coordinate with other agents.`,
          `Always reply via: openscout relay send --as ${twinName} "your message"`,
          `Be specific with file paths. Keep messages under 200 chars.`,
        ].join("\n");

        const twinDir = path.join(hub, "twins");
        await fs.mkdir(twinDir, { recursive: true });
        const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
        await fs.writeFile(promptFile, systemPrompt);
        const initialMsg = `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
        const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
        await fs.writeFile(initialFile, initialMsg);
        const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
        await fs.writeFile(launchScript, [
          `#!/bin/bash`,
          `cd ${JSON.stringify(projectPath)}`,
          `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
          `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
        ].join("\n") + "\n");
        await fs.chmod(launchScript, 0o755);
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

        const currentTwins = await loadTwins();
        currentTwins[twinName] = { project: projectName, tmuxSession, cwd: projectPath, startedAt: Math.floor(Date.now() / 1000) };
        await saveTwins(currentTwins);

        const ts = Math.floor(Date.now() / 1000);
        await fs.appendFile(logPath, `${ts} ${twinName} SYS twin spawned for ${projectName}\n`);
        results.push(`${name} (up)`);
      }
      return results.join(", ");
    }

    // Resolve: bare name → <projectRoot>/<name>, or use as path
    let projectPath = await resolveProjectPath(target);

    // Verify it exists
    try {
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) return `not a directory: ${target}`;
    } catch {
      return `not found: ${projectPath}`;
    }

    const projectName = path.basename(projectPath);
    const twinName = parts[2] || projectName; // optional alias as 3rd arg
    const tmuxSession = `relay-${twinName}`;

    // Check if already running
    if (isTmuxSessionAlive(tmuxSession)) {
      return `${twinName} is already running`;
    }

    // Build system prompt
    const hubShort = hub.replace(os.homedir(), "~");
    const systemPrompt = [
      `You are "${twinName}", a relay twin — a headless agent that handles relay communication for the ${projectName} project.`,
      `You have full access to the codebase at ${projectPath}.`,
      `There is a global relay channel at ${hubShort}/channel.log shared by all agents.`,
      `Your job: respond to @${twinName} mentions, answer questions about this project's code, coordinate with other agents.`,
      `Relay commands:`,
      `  openscout relay send --as ${twinName} "your message"`,
      `  openscout relay read`,
      `  openscout relay who`,
      `Rules: always reply via relay send, be specific with file paths, keep messages under 200 chars.`,
    ].join("\n");

    // Write files
    const twinDir = path.join(hub, "twins");
    await fs.mkdir(twinDir, { recursive: true });
    const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
    await fs.writeFile(promptFile, systemPrompt);

    const initialMsg = `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;
    const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
    await fs.writeFile(initialFile, initialMsg);

    const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
    await fs.writeFile(launchScript, [
      `#!/bin/bash`,
      `cd ${JSON.stringify(projectPath)}`,
      `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
      `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
    ].join("\n") + "\n");
    await fs.chmod(launchScript, 0o755);

    // Spawn
    execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

    // Save registry
    const twins = await loadTwins();
    twins[twinName] = {
      project: projectName,
      tmuxSession,
      cwd: projectPath,
      startedAt: Math.floor(Date.now() / 1000),
    };
    await saveTwins(twins);

    const ts = Math.floor(Date.now() / 1000);
    await fs.appendFile(logPath, `${ts} ${twinName} SYS twin spawned for ${projectName}\n`);

    return `✓ spawned ${twinName} (tmux: ${tmuxSession})`;
  }

  if (cmd === "down") {
    const target = parts[1];
    if (!target) return "usage: @system down <name> | @system down --all";

    const twins = await loadTwins();

    if (target === "--all") {
      const names = Object.keys(twins);
      if (names.length === 0) return "no twins to stop";
      const results: string[] = [];
      for (const name of names) {
        try {
          execSync(`tmux kill-session -t ${twins[name].tmuxSession} 2>/dev/null`);
          results.push(`✓ ${name}`);
        } catch {
          results.push(`○ ${name} (already stopped)`);
        }
      }
      await saveTwins({});
      const ts = Math.floor(Date.now() / 1000);
      await fs.appendFile(logPath, `${ts} system SYS all twins stopped\n`);
      return results.join(", ");
    }

    const twin = twins[target];
    if (!twin) {
      const names = Object.keys(twins);
      return names.length > 0
        ? `no twin named ${target}. running: ${names.join(", ")}`
        : `no twin named ${target}`;
    }

    try {
      execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
    } catch { /* already gone */ }
    delete twins[target];
    await saveTwins(twins);

    const ts = Math.floor(Date.now() / 1000);
    await fs.appendFile(logPath, `${ts} ${target} SYS twin stopped\n`);
    return `✓ stopped ${target}`;
  }

  if (cmd === "config") {
    const key = parts[1];
    const value = parts[2];

    if (key === "root" && value) {
      const config = await loadRelayConfig();
      config.projectRoot = value;
      await saveRelayConfig(config);
      return `set project root to ${value}`;
    }

    if (key === "speak" && value) {
      const config = await loadRelayConfig();
      if (value === "off" || value === "none") {
        delete config.speakFor;
        await saveRelayConfig(config);
        return "speak disabled";
      }
      config.speakFor = value;
      await saveRelayConfig(config);
      return `speak enabled for @${value} mentions`;
    }

    if (key === "voice" && value) {
      const config = await loadRelayConfig();
      config.speakVoice = value;
      await saveRelayConfig(config);
      return `voice set to ${value}`;
    }

    // Show current config
    const config = await loadRelayConfig();
    const root = config.projectRoot || "~/dev (default)";
    const speak = config.speakFor ? `@${config.speakFor}` : "off";
    const voice = config.speakVoice || "nova (default)";
    return `root: ${root} | speak: ${speak} | voice: ${voice}`;
  }

  return `unknown command: ${cmd}. try: up, down, ps, config`;
}

async function relaySend() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  // Collect message: everything after "send" that isn't --as <name>
  const sendIdx = args.indexOf("send");
  const msgParts: string[] = [];
  let i = sendIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") {
      i += 2; // skip --as and its value
      continue;
    }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m No message provided. Usage: openscout relay send \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${agent} MSG ${message}\n`);

  print(formatLine(`${ts} ${agent} MSG ${message}`));

  // Check for @system command
  if (message.match(/@system\b/i)) {
    const result = await handleSystemCommand(agent, message);
    if (result) {
      const replyTs = Math.floor(Date.now() / 1000);
      await fs.appendFile(logPath, `${replyTs} system MSG @${agent} ${result}\n`);
      print(formatLine(`${replyTs} system MSG @${agent} ${result}`));
    }
    return;
  }

  // Auto-deliver to @mentioned agents
  const mentions = message.match(/@([\w.-]+)/g);
  if (mentions) {
    for (const mention of mentions) {
      const target = mention.slice(1); // remove @
      if (target === agent) continue; // don't deliver to yourself
      const result = await deliverToAgent(target, agent, message);
      if (result === "delivered") {
        print(`  \x1b[32m✓\x1b[0m Delivered to ${target}'s session (resumed)`);
      } else if (result === "nudged") {
        print(`  \x1b[33m○\x1b[0m Nudged ${target} via tmux (session not found)`);
      } else {
        print(`  \x1b[2m○\x1b[0m ${target} not registered — message queued in channel\x1b[0m`);
      }
    }
  }
}

async function relayRead() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  const content = await fs.readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  // --since <timestamp> filter
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx !== -1 ? Number(args[sinceIdx + 1]) : 0;

  // -n <count> or default 20
  const nIdx = args.indexOf("-n");
  const count = nIdx !== -1 ? Number(args[nIdx + 1]) : 20;

  let filtered = lines;
  if (since > 0) {
    filtered = lines.filter((l) => {
      const ts = Number(l.split(" ")[0]);
      return ts > since;
    });
  } else {
    filtered = lines.slice(-count);
  }

  if (filtered.length === 0) {
    print("\n  \x1b[2mNo messages.\x1b[0m\n");
    return;
  }

  print("");
  for (const line of filtered) {
    print(formatLine(line));
  }
  print("");
}

async function relayWatch() {
  const fs = await import("node:fs");
  const { logPath } = await requireRelay();
  const { execSync } = await import("node:child_process");

  const agent = getAgentName();
  const tmuxIdx = args.indexOf("--tmux");
  const tmuxPane = tmuxIdx !== -1 ? args[tmuxIdx + 1] : null;

  // Write join message
  const joinTs = Math.floor(Date.now() / 1000);
  fs.appendFileSync(logPath, `${joinTs} ${agent} SYS ${agent} joined the relay\n`);

  // Start reading from end of file
  const stat = fs.statSync(logPath);
  let position = stat.size;

  printBrand();
  print(`  Watching as \x1b[1m${agent}\x1b[0m ${tmuxPane ? `(nudging tmux pane ${tmuxPane})` : ""}`);
  print("  \x1b[2mPress Ctrl+C to stop\x1b[0m\n");

  const readNew = () => {
    const current = fs.statSync(logPath);
    if (current.size <= position) return;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(current.size - position);
    fs.readSync(fd, buf, 0, buf.length, position);
    fs.closeSync(fd);
    position = current.size;

    const newContent = buf.toString("utf-8");
    const lines = newContent.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.split(" ");
      const from = parts[1];

      // Don't echo our own messages back
      if (from === agent) continue;

      print(formatLine(line));

      // Tmux nudge
      if (tmuxPane) {
        const type = parts[2];
        const body = parts.slice(3).join(" ");
        const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
        const nudge = type === "SYS"
          ? `[relay] ${body}`
          : `[relay] ${from}: ${preview}`;
        try {
          execSync(`tmux send-keys -t ${tmuxPane} ${JSON.stringify(nudge)} Enter`);
        } catch {
          // tmux not available or pane doesn't exist — silently skip
        }
      }
    }
  };

  fs.watch(logPath, () => readNew());

  // Keep process alive
  process.on("SIGINT", () => {
    const leaveTs = Math.floor(Date.now() / 1000);
    fs.appendFileSync(logPath, `${leaveTs} ${agent} SYS ${agent} left the relay\n`);
    print(`\n  \x1b[2m${agent} left the relay\x1b[0m\n`);
    process.exit(0);
  });
}

async function relaySpeak() {
  const fs = await import("node:fs");
  const { spawn } = await import("node:child_process");
  const { logPath } = await requireRelay();

  const agent = getAgentName();

  // Resolve who we're speaking for (default: system username)
  const forIdx = args.indexOf("--for");
  const speakFor = forIdx !== -1 && args[forIdx + 1]
    ? args[forIdx + 1]
    : process.env.USER || "arach";

  // Resolve OpenAI API key
  let apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    try {
      const path = await import("node:path");
      const os = await import("node:os");
      const settingsPath = path.join(os.homedir(), ".config", "speakeasy", "settings.json");
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      apiKey = settings.providers?.openai?.apiKey || null;
    } catch { /* noop */ }
  }

  if (!apiKey) {
    print("\n  \x1b[31m✗\x1b[0m No OpenAI API key found.");
    print("  Set OPENAI_API_KEY or add it to ~/.config/speakeasy/settings.json\n");
    process.exit(1);
  }

  // Voice config
  const voiceIdx = args.indexOf("--voice");
  const voice = voiceIdx !== -1 && args[voiceIdx + 1] ? args[voiceIdx + 1] : "nova";

  // Start reading from end of file (only speak new messages)
  const stat = fs.statSync(logPath);
  let position = stat.size;
  let speaking = false;

  printBrand();
  print(`  Speaker active — listening for @${speakFor} mentions`);
  print(`  \x1b[2mvoice: ${voice} · Ctrl+C to stop\x1b[0m\n`);

  const speakText = async (text: string) => {
    if (speaking) return; // don't overlap
    speaking = true;
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice,
          input: text,
          response_format: "pcm",
          speed: 1.1,
        }),
      });

      if (!res.ok || !res.body) {
        speaking = false;
        return;
      }

      const player = spawn("ffplay", [
        "-nodisp", "-autoexit", "-loglevel", "quiet",
        "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-",
      ], { stdio: ["pipe", "ignore", "ignore"] });

      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        player.stdin.write(value);
      }
      player.stdin.end();

      await new Promise<void>((resolve) => player.on("close", resolve));
    } catch {
      // TTS failed — skip silently
    }
    speaking = false;
  };

  const readNew = () => {
    const current = fs.statSync(logPath);
    if (current.size <= position) return;

    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(current.size - position);
    fs.readSync(fd, buf, 0, buf.length, position);
    fs.closeSync(fd);
    position = current.size;

    const newContent = buf.toString("utf-8");
    const lines = newContent.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const parts = line.split(" ");
      const [, from, type, ...rest] = parts;
      const body = rest.join(" ");

      // Only speak MSG from others that mention us
      if (type !== "MSG") continue;
      if (from === speakFor || from === "system") continue;
      if (!body.includes(`@${speakFor}`)) continue;

      // Clean the text for speech
      const clean = body.replace(new RegExp(`@${speakFor}\\s*`, "g"), "").trim();
      if (!clean) continue;

      const preview = clean.length > 60 ? clean.slice(0, 60) + "…" : clean;
      print(`  \x1b[2m${formatTimestamp(Number(parts[0]))}\x1b[0m \x1b[1m${from}\x1b[0m → \x1b[2mspeaking\x1b[0m  ${preview}`);
      speakText(clean);
    }
  };

  fs.watch(logPath, () => readNew());

  process.on("SIGINT", () => {
    print(`\n  \x1b[2mSpeaker stopped\x1b[0m\n`);
    process.exit(0);
  });
}

async function relayWho() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  const content = await fs.readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const now = Math.floor(Date.now() / 1000);
  const ONLINE_THRESHOLD = 600; // 10 minutes

  // Build agent map
  const agents = new Map<string, { lastSeen: number; messages: number; forgotten: boolean }>();

  for (const line of lines) {
    const parts = line.split(" ");
    const [ts, from, type, ...rest] = parts;
    const timestamp = Number(ts);
    const body = rest.join(" ");

    if (!agents.has(from)) {
      agents.set(from, { lastSeen: timestamp, messages: 0, forgotten: false });
    }
    const agent = agents.get(from)!;
    agent.lastSeen = Math.max(agent.lastSeen, timestamp);

    if (type === "MSG") agent.messages++;
    if (type === "SYS" && body.includes("forgotten")) agent.forgotten = true;
  }

  // Filter out forgotten agents
  const visible = [...agents.entries()].filter(([_, info]) => !info.forgotten);

  if (visible.length === 0) {
    print("\n  \x1b[2mNo agents have used the relay yet.\x1b[0m\n");
    return;
  }

  printBrand();
  print("  \x1b[1mAgents\x1b[0m\n");

  for (const [name, info] of visible) {
    const isOnline = (now - info.lastSeen) < ONLINE_THRESHOLD;
    const status = isOnline ? "\x1b[32m●\x1b[0m" : "\x1b[2m○\x1b[0m";
    const time = formatTimestamp(info.lastSeen);
    const msgs = info.messages === 1 ? "1 message" : `${info.messages} messages`;
    print(`  ${status} \x1b[1m${name}\x1b[0m  \x1b[2m${msgs} · last seen ${time}\x1b[0m`);
  }
  print("");
}

async function relayForget() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  // Get agent name to forget from args after "forget"
  const forgetIdx = args.indexOf("forget");
  const targetName = forgetIdx !== -1 ? args[forgetIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay forget <agent-name>\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${targetName} SYS ${targetName} forgotten by ${agent}\n`);

  print(`\n  \x1b[32m✓\x1b[0m Removed \x1b[1m${targetName}\x1b[0m from the relay.\n`);
}

async function relayEnroll() {
  const fs = await import("node:fs/promises");
  const { logPath } = await requireRelay();

  const agent = getAgentName();

  // Check for --task flag
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const prompt = [
    `You are ${agent}.`,
    "",
    `There is a global relay channel at ${logPath} that other agents are watching.`,
    "Use it to coordinate with other agents working on related packages.",
    "",
    "Relay commands:",
    `  openscout relay send --as ${agent} "your message"   — send a message`,
    `  openscout relay read                                — check recent messages`,
    `  openscout relay who                                 — see who's active`,
    "",
    "Rules:",
    "  - Check the relay before starting work for context from other agents",
    "  - Send a message when you complete something other agents need to know about",
    "  - Be specific: include file paths, version numbers, what changed",
    "  - Keep messages under 200 chars",
    task ? `\nYour task: ${task}` : "",
  ].filter((l) => l !== undefined).join("\n");

  // Try to copy to clipboard
  let copied = false;
  try {
    const { execSync } = await import("node:child_process");
    execSync("pbcopy", { input: prompt });
    copied = true;
  } catch {
    // No pbcopy available
  }

  printBrand();
  print(`  Enrollment prompt for \x1b[1m${agent}\x1b[0m${copied ? " \x1b[32m(copied to clipboard)\x1b[0m" : ""}:\n`);
  print("  ┌──────────────────────────────────────────────────────────────");
  for (const line of prompt.split("\n")) {
    print(`  │ ${line}`);
  }
  print("  └──────────────────────────────────────────────────────────────\n");

  if (copied) {
    print("  \x1b[32m✓\x1b[0m Paste this into a Claude Code session to enroll the agent.");
  } else {
    print("  Copy the prompt above and paste it into a Claude Code session.");
  }

  // Write a SYS event
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${agent} SYS ${agent} enrolled via relay enroll\n`);

  print(`  \x1b[32m✓\x1b[0m Wrote enrollment event to channel.log\n`);
}

async function relayBroadcast() {
  const fs = await import("node:fs/promises");
  const { execSync } = await import("node:child_process");
  const { logPath } = await requireRelay();

  // Collect message
  const bcIdx = args.indexOf("broadcast");
  const msgParts: string[] = [];
  let i = bcIdx + 1;
  while (i < args.length) {
    if (args[i] === "--as") { i += 2; continue; }
    msgParts.push(args[i]);
    i++;
  }

  const message = msgParts.join(" ").trim();
  if (!message) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay broadcast \"your message\"\n");
    process.exit(1);
  }

  const agent = getAgentName();
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${agent} MSG 📢 ${message}\n`);

  print(formatLine(`${ts} ${agent} MSG 📢 ${message}`));

  // Nudge all tmux panes
  let nudged = 0;
  try {
    const panes = execSync("tmux list-panes -a -F '#{pane_id}'", { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);

    const preview = message.length > 60 ? message.slice(0, 60) + "…" : message;
    for (const pane of panes) {
      try {
        execSync(`tmux send-keys -t ${pane} ${JSON.stringify(`[broadcast] ${agent}: ${preview}`)} Enter`);
        nudged++;
      } catch {
        // pane may not accept input — skip
      }
    }
  } catch {
    // tmux not running — that's fine
  }

  if (nudged > 0) {
    print(`  \x1b[32m✓\x1b[0m Nudged ${nudged} tmux pane${nudged === 1 ? "" : "s"}`);
  }
  print("");
}

async function relayLink() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");

  // Verify global hub exists
  try {
    await fs.access(logPath);
  } catch {
    print("\n  \x1b[31m✗\x1b[0m Global relay not initialized. Run \x1b[1mopenscout relay init\x1b[0m first.\n");
    process.exit(1);
  }

  // Create local link
  const localDir = path.join(process.cwd(), ".openscout");
  await fs.mkdir(localDir, { recursive: true });
  const linkPath = path.join(localDir, "relay.json");
  const hubShort = hub.replace(os.homedir(), "~");
  await fs.writeFile(
    linkPath,
    JSON.stringify({ hub: hubShort, linkedAt: new Date().toISOString() }, null, 2) + "\n"
  );

  const cwd = process.cwd();
  const projectName = cwd.split("/").pop() || "unknown";
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${projectName} SYS ${projectName} linked to the relay\n`);

  printBrand();
  print(`  \x1b[32m✓\x1b[0m Linked \x1b[1m${projectName}\x1b[0m → \x1b[1m${hubShort}/\x1b[0m\n`);
  print("  Agents in this directory now share the global relay channel.");
  print("  Run \x1b[1mopenscout relay read\x1b[0m to see messages from all projects.\n");
}

// ── Twins ─────────────────────────────────────────────

interface TwinEntry {
  project: string;
  tmuxSession: string;
  cwd: string;
  startedAt: number;
  systemPrompt?: string;
}

async function loadTwins(): Promise<Record<string, TwinEntry>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const twinsPath = path.join(hub, "twins.json");
  try {
    const raw = await fs.readFile(twinsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTwins(twins: Record<string, TwinEntry>): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const hub = await getGlobalRelayDir();
  const twinsPath = path.join(hub, "twins.json");
  await fs.writeFile(twinsPath, JSON.stringify(twins, null, 2) + "\n");
}

function isTmuxSessionAlive(sessionName: string): boolean {
  try {
    const { execSync } = require("node:child_process");
    execSync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

async function relayUp() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  // Parse: relay up <path-or-name> [--name <alias>] [--task <task>]
  const upIdx = args.indexOf("up");
  const targetArg = args[upIdx + 1];

  if (!targetArg || targetArg.startsWith("--")) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay up <project-path> [--name <alias>] [--task <description>]\n");
    print("  \x1b[1mExamples:\x1b[0m");
    print("    openscout relay up ~/dev/lattices");
    print("    openscout relay up ~/dev/arc --name arc-twin");
    print("    openscout relay up . --task \"monitor tests\"\n");
    process.exit(1);
  }

  // Resolve project path (bare names use projectRoot from config)
  let projectPath = targetArg === "." ? process.cwd() : await resolveProjectPath(targetArg);

  // Verify directory exists
  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    print(`\n  \x1b[31m✗\x1b[0m Not a directory: ${targetArg}\n`);
    process.exit(1);
  }

  const projectName = path.basename(projectPath);

  // Parse optional name
  const nameIdx = args.indexOf("--name");
  const twinName = nameIdx !== -1 ? args[nameIdx + 1] : projectName;

  // Parse optional task
  const taskIdx = args.indexOf("--task");
  const task = taskIdx !== -1 ? args.slice(taskIdx + 1).filter((a) => !a.startsWith("--")).join(" ") : "";

  const tmuxSession = `relay-${twinName}`;

  // Check if already running
  if (isTmuxSessionAlive(tmuxSession)) {
    print(`\n  \x1b[33m!\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is already running (tmux: ${tmuxSession})`);
    print(`  \x1b[2mUse: openscout relay down ${twinName}\x1b[0m\n`);
    process.exit(1);
  }

  // Build the enrollment system prompt
  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const logPath = path.join(hub, "channel.log");

  const systemPrompt = [
    `You are "${twinName}", a relay twin — a headless agent that handles relay communication for the ${projectName} project.`,
    ``,
    `You have full access to the codebase at ${projectPath}.`,
    `There is a global relay channel at ${hubShort}/channel.log shared by all agents.`,
    ``,
    `Your job:`,
    `  - Respond to @${twinName} mentions from other agents`,
    `  - Answer questions about this project's code, architecture, and status`,
    `  - Coordinate with other agents when they need info from this project`,
    `  - Run commands, check code, and provide accurate answers`,
    ``,
    `Relay commands:`,
    `  openscout relay send --as ${twinName} "your message"   — send a message`,
    `  openscout relay read                                   — check recent messages`,
    `  openscout relay who                                    — see who's active`,
    ``,
    `Rules:`,
    `  - Always reply via relay send so other agents see your response`,
    `  - Be specific: include file paths, line numbers, what you found`,
    `  - Keep messages under 200 chars unless detailed info was requested`,
    `  - Check relay read for context before responding`,
    task ? `\nYour primary task: ${task}` : "",
  ].filter(Boolean).join("\n");

  // Create the tmux session with claude
  printBrand();
  print(`  Spawning twin \x1b[1m${twinName}\x1b[0m...\n`);

  // Write system prompt + launcher to files (avoids shell quoting hell)
  const twinDir = path.join(hub, "twins");
  await fs.mkdir(twinDir, { recursive: true });
  const promptFile = path.join(twinDir, `${twinName}.prompt.txt`);
  await fs.writeFile(promptFile, systemPrompt);

  const initialMsg = task
    ? `You are now online as a relay twin. Your task: ${task}. Announce yourself on the relay and start working.`
    : `You are now online as a relay twin for ${projectName}. Announce yourself on the relay with: openscout relay send --as ${twinName} "twin online — ready to assist with ${projectName}"`;

  const initialFile = path.join(twinDir, `${twinName}.initial.txt`);
  await fs.writeFile(initialFile, initialMsg);

  // Launcher: starts Claude interactively, then sends initial message after startup
  const launchScript = path.join(twinDir, `${twinName}.launch.sh`);
  await fs.writeFile(launchScript, [
    `#!/bin/bash`,
    `cd ${JSON.stringify(projectPath)}`,
    `# Send initial message after Claude starts (background)`,
    `(sleep 5 && tmux send-keys -t ${tmuxSession} "$(cat ${JSON.stringify(initialFile)})" Enter) &`,
    `exec claude --append-system-prompt "$(cat ${JSON.stringify(promptFile)})" --name "${twinName}-twin"`,
  ].join("\n") + "\n");
  await fs.chmod(launchScript, 0o755);

  // Create detached tmux session running the launcher
  execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(projectPath)} ${JSON.stringify(launchScript)}`);

  // Save to twins registry
  const twins = await loadTwins();
  twins[twinName] = {
    project: projectName,
    tmuxSession,
    cwd: projectPath,
    startedAt: Math.floor(Date.now() / 1000),
    systemPrompt: task || undefined,
  };
  await saveTwins(twins);

  // Log to channel
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${twinName} SYS twin spawned for ${projectName}\n`);

  print(`  \x1b[32m✓\x1b[0m Twin \x1b[1m${twinName}\x1b[0m is alive`);
  print(`  \x1b[2m  tmux: ${tmuxSession}\x1b[0m`);
  print(`  \x1b[2m  cwd:  ${projectPath}\x1b[0m`);
  if (task) print(`  \x1b[2m  task: ${task}\x1b[0m`);
  print("");
  print("  \x1b[1mUseful commands:\x1b[0m");
  print(`    tmux attach -t ${tmuxSession}        \x1b[2m# peek at the twin\x1b[0m`);
  print(`    openscout relay send "@${twinName} hey"  \x1b[2m# talk to it\x1b[0m`);
  print(`    openscout relay ps                    \x1b[2m# check all twins\x1b[0m`);
  print(`    openscout relay down ${twinName}          \x1b[2m# stop it\x1b[0m\n`);
}

async function relayDown() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");
  await requireRelay();

  const downIdx = args.indexOf("down");
  const targetName = downIdx !== -1 ? args[downIdx + 1] : undefined;

  if (!targetName) {
    print("\n  \x1b[31m✗\x1b[0m Usage: openscout relay down <twin-name>\n");
    process.exit(1);
  }

  // Check --all flag
  if (targetName === "--all") {
    const twins = await loadTwins();
    const names = Object.keys(twins);
    if (names.length === 0) {
      print("\n  \x1b[2mNo twins to stop.\x1b[0m\n");
      return;
    }

    printBrand();
    for (const name of names) {
      const twin = twins[name];
      try {
        execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
        print(`  \x1b[32m✓\x1b[0m Stopped \x1b[1m${name}\x1b[0m`);
      } catch {
        print(`  \x1b[2m○\x1b[0m ${name} was already stopped`);
      }
    }

    // Clear registry
    await saveTwins({});

    const hub = await getGlobalRelayDir();
    const logPath = path.join(hub, "channel.log");
    const ts = Math.floor(Date.now() / 1000);
    await fs.appendFile(logPath, `${ts} system SYS all twins stopped\n`);

    print("");
    return;
  }

  const twins = await loadTwins();
  const twin = twins[targetName];

  if (!twin) {
    print(`\n  \x1b[31m✗\x1b[0m No twin named \x1b[1m${targetName}\x1b[0m.`);
    const names = Object.keys(twins);
    if (names.length > 0) {
      print(`  \x1b[2mRunning twins: ${names.join(", ")}\x1b[0m`);
    }
    print("");
    process.exit(1);
  }

  // Kill tmux session
  try {
    execSync(`tmux kill-session -t ${twin.tmuxSession} 2>/dev/null`);
    print(`\n  \x1b[32m✓\x1b[0m Stopped twin \x1b[1m${targetName}\x1b[0m (tmux: ${twin.tmuxSession})`);
  } catch {
    print(`\n  \x1b[2m○\x1b[0m Twin \x1b[1m${targetName}\x1b[0m tmux session was already gone.`);
  }

  // Remove from registry
  delete twins[targetName];
  await saveTwins(twins);

  // Log to channel
  const hub = await getGlobalRelayDir();
  const logPath = path.join(hub, "channel.log");
  const ts = Math.floor(Date.now() / 1000);
  await fs.appendFile(logPath, `${ts} ${targetName} SYS twin stopped\n`);

  print("");
}

async function relayPs() {
  const { execSync } = await import("node:child_process");
  await requireRelay();

  const twins = await loadTwins();
  const names = Object.keys(twins);

  printBrand();
  print("  \x1b[1mTwins\x1b[0m\n");

  if (names.length === 0) {
    print("  \x1b[2m(no twins running)\x1b[0m");
    print("  \x1b[2mSpawn one: openscout relay up ~/dev/my-project\x1b[0m\n");
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  for (const name of names) {
    const twin = twins[name];
    const alive = isTmuxSessionAlive(twin.tmuxSession);
    const status = alive ? "\x1b[32m●\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const uptime = now - twin.startedAt;
    const uptimeStr = uptime < 60
      ? `${uptime}s`
      : uptime < 3600
        ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    print(`  ${status} \x1b[1m${name}\x1b[0m  \x1b[2m${twin.project} · up ${uptimeStr} · tmux:${twin.tmuxSession}\x1b[0m`);

    if (twin.systemPrompt) {
      const taskPreview = twin.systemPrompt.length > 60 ? twin.systemPrompt.slice(0, 60) + "…" : twin.systemPrompt;
      print(`    \x1b[2mtask: ${taskPreview}\x1b[0m`);
    }
  }
  print("");

  // Clean up dead twins
  let cleaned = false;
  for (const name of names) {
    if (!isTmuxSessionAlive(twins[name].tmuxSession)) {
      delete twins[name];
      cleaned = true;
    }
  }
  if (cleaned) {
    await saveTwins(twins);
    print("  \x1b[2m(cleaned up dead twins from registry)\x1b[0m\n");
  }
}

async function relayStatus() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hub = await getGlobalRelayDir();
  const hubShort = hub.replace(os.homedir(), "~");
  const logPath = path.join(hub, "channel.log");

  printBrand();

  // Check global hub
  try {
    await fs.access(logPath);
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const msgCount = lines.filter((l) => l.split(" ")[2] === "MSG").length;
    print(`  \x1b[32m✓\x1b[0m Hub: \x1b[1m${hubShort}/\x1b[0m  \x1b[2m(${lines.length} lines, ${msgCount} messages)\x1b[0m`);
  } catch {
    print(`  \x1b[31m✗\x1b[0m Hub: \x1b[2mnot initialized\x1b[0m`);
    print("\n  Run \x1b[1mopenscout relay init\x1b[0m to create the global hub.\n");
    return;
  }

  // Check local link
  const localLink = path.join(process.cwd(), ".openscout", "relay.json");
  try {
    const raw = await fs.readFile(localLink, "utf-8");
    const config = JSON.parse(raw);
    const projectName = process.cwd().split("/").pop() || "unknown";
    print(`  \x1b[32m✓\x1b[0m Link: \x1b[1m${projectName}\x1b[0m → ${config.hub}  \x1b[2m(${config.linkedAt?.slice(0, 10) || "?"})\x1b[0m`);
  } catch {
    const projectName = process.cwd().split("/").pop() || "unknown";
    print(`  \x1b[33m○\x1b[0m Link: \x1b[1m${projectName}\x1b[0m \x1b[2m— not linked (run \x1b[0mopenscout relay link\x1b[2m)\x1b[0m`);
  }

  // Show linked projects by scanning known locations
  // (We can't enumerate all links, but we can show what the user might expect)
  print("");
}

function relayHelp() {
  printBrand();
  print("  \x1b[1mRelay\x1b[0m — file-based agent chat\n");
  print("  \x1b[2mGlobal hub at ~/.openscout/relay/ — all projects share one channel.\x1b[0m\n");
  print("  \x1b[1mUsage:\x1b[0m");
  print("    openscout relay <command> [options]\n");
  print("  \x1b[1mCommands:\x1b[0m");
  print("    init                           Create global hub + link this project");
  print("    link                           Link this project to the global hub");
  print("    status                         Show hub and link status");
  print("    send <message>                 Append a message to the channel");
  print("    read                           Print recent messages (last 20)");
  print("    read --since <timestamp>       Messages after a unix timestamp");
  print("    read -n <count>                Show last N messages");
  print("    watch                          Stream new messages as they arrive");
  print("    watch --tmux <pane>            Stream + nudge a tmux pane on new messages");
  print("    who                            List agents and their last activity");
  print("    forget <name>                  Remove a stale agent from the list");
  print("    tui                            Open the relay monitor dashboard");
  print("    enroll --as <name>             Generate enrollment prompt for an agent");
  print("    broadcast <message>            Send + nudge all tmux panes (alias: bc)\n");
  print("  \x1b[1mAudio:\x1b[0m");
  print("    speak                             Speak @mentions aloud via TTS (background)");
  print("    speak --for <name>                Listen for a specific agent's mentions");
  print("    speak --voice <voice>             OpenAI voice (default: nova)\n");
  print("  \x1b[1mTwins:\x1b[0m \x1b[2m(headless agents in detached tmux sessions)\x1b[0m");
  print("    up <path> [--name n] [--task t]  Spawn a twin for a project");
  print("    down <name>                      Stop a twin");
  print("    down --all                       Stop all twins");
  print("    ps                               List running twins\n");
  print("  \x1b[1mIdentity:\x1b[0m");
  print("    --as <name>                    Set agent name for this command");
  print("    OPENSCOUT_AGENT=<name>         Set agent name via env var\n");
  print("  \x1b[1mExamples:\x1b[0m");
  print("    openscout relay init                              # first time");
  print("    openscout relay up ~/dev/lattices                 # spawn a twin");
  print("    openscout relay up ~/dev/arc --task \"run tests\"   # twin with a task");
  print("    openscout relay ps                                # check twins");
  print("    openscout relay send --as dev \"@lattices hey\"     # talk to a twin");
  print("    openscout relay down lattices                     # stop a twin");
  print("    openscout relay tui\n");
}

async function relay() {
  const sub = args[1];

  switch (sub) {
    case "init":
      await relayInit();
      break;
    case "send":
      await relaySend();
      break;
    case "read":
      await relayRead();
      break;
    case "watch":
      await relayWatch();
      break;
    case "who":
      await relayWho();
      break;
    case "enroll":
      await relayEnroll();
      break;
    case "forget":
      await relayForget();
      break;
    case "broadcast":
    case "bc":
      await relayBroadcast();
      break;
    case "link":
      await relayLink();
      break;
    case "status":
      await relayStatus();
      break;
    case "up":
      await relayUp();
      break;
    case "down":
      await relayDown();
      break;
    case "ps":
      await relayPs();
      break;
    case "speak":
      await relaySpeak();
      break;
    case "tui": {
      const { execSync } = await import("node:child_process");
      const path = await import("node:path");
      const tuiPath = path.join(import.meta.dirname, "..", "src", "tui", "index.tsx");
      const tmuxSession = "relay-tui";

      // If already inside the relay-tui tmux session, just run the TUI
      if (process.env.TMUX && process.env.TMUX.includes(tmuxSession)) {
        try {
          execSync(`bun run ${tuiPath}`, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // If --no-tmux flag, run directly
      if (args.includes("--no-tmux")) {
        try {
          execSync(`bun run ${tuiPath}`, { stdio: "inherit", cwd: process.cwd() });
        } catch { /* TUI exited — normal */ }
        break;
      }

      // Otherwise, wrap in a tmux session for tiling support
      try {
        // Kill stale session if it exists
        try { execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`); } catch { /* noop */ }

        // Create tmux session with settings optimized for TUI rendering
        execSync(`tmux new-session -d -s ${tmuxSession} -c ${JSON.stringify(process.cwd())} -x $(tput cols) -y $(tput lines)`);
        // Reduce flicker: disable status bar in this session, set escape-time to 0
        try {
          execSync(`tmux set-option -t ${tmuxSession} status off 2>/dev/null`);
          execSync(`tmux set-option -t ${tmuxSession} escape-time 0 2>/dev/null`);
        } catch { /* noop */ }
        // Send the TUI command and attach
        execSync(`tmux send-keys -t ${tmuxSession} ${JSON.stringify(`bun run ${tuiPath}`)} Enter`);
        execSync(`tmux attach -t ${tmuxSession}`, { stdio: "inherit" });
      } catch {
        // tmux not available or user quit — that's fine
      }
      break;
    }
    case "--help":
    case "-h":
    case undefined:
      relayHelp();
      break;
    default:
      print(`\n  \x1b[31m✗\x1b[0m Unknown relay command: ${sub}\n`);
      relayHelp();
      process.exit(1);
  }
}

// ── Route ──────────────────────────────────────────────

switch (command) {
  case "init":
    init();
    break;
  case "add":
    add();
    break;
  case "run":
    run();
    break;
  case "list":
  case "ls":
    list();
    break;
  case "relay":
    relay();
    break;
  case "--version":
  case "-v":
    print(VERSION);
    break;
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    print(`\n  \x1b[31m✗\x1b[0m Unknown command: ${command}\n`);
    help();
    process.exit(1);
}
